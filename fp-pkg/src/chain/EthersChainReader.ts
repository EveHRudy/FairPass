import { Contract, Interface, JsonRpcProvider, getAddress, type Fragment, type FunctionFragment, type Log } from 'ethers';
import fs from 'node:fs';
import type { AppConfig } from '../config.js';
import { ChainUnavailableError } from '../errors.js';
import type { ChainReader, RawLog, ResalePolicy } from './ChainReader.js';

/** Events the indexer understands. Only those that really exist in the ABI are used. */
export const TRACKED_EVENTS = [
  'EventCreated', 'TicketMinted', 'Listed', 'Sold', 'CheckedIn',
  // optional: only used when the contract actually declares them
  'ListingCancelled', 'Cancelled', 'Delisted',
] as const;

const CHECKED_IN_CANDIDATES = ['isCheckedIn', 'checkedIn', 'isUsed', 'ticketUsed', 'usedTickets', 'used', 'hasCheckedIn'];
const CAP_CANDIDATES = ['maxResaleCapPercent', 'resaleCapPercent', 'capPercent', 'maxResalePercent', 'priceCapPercent', 'resaleCap'];
const ROYALTY_CANDIDATES = ['royaltyPercent', 'royaltyPercentage', 'organizerRoyaltyPercent', 'royaltyBps', 'royaltyBasisPoints'];

export function loadAbi(abiPath: string): Interface {
  const raw = JSON.parse(fs.readFileSync(abiPath, 'utf8'));
  return new Interface(Array.isArray(raw) ? raw : raw.abi);
}

function findFn(iface: Interface, names: string[], inputs: number): FunctionFragment | undefined {
  for (const n of names) {
    const f = iface.fragments.find(
      (x: Fragment) => x.type === 'function' && (x as FunctionFragment).name === n && (x as FunctionFragment).inputs.length === inputs &&
        ['view', 'pure'].includes((x as FunctionFragment).stateMutability),
    ) as FunctionFragment | undefined;
    if (f) return f;
  }
  return undefined;
}

function isCallException(err: unknown): boolean {
  const e = err as { code?: string };
  return e?.code === 'CALL_EXCEPTION' || e?.code === 'BAD_DATA';
}
function wrap(err: unknown): never {
  throw new ChainUnavailableError('Blockchain node is temporarily unavailable', err);
}

export class EthersChainReader implements ChainReader {
  readonly contractAddress: string;
  private provider: JsonRpcProvider;
  private contract: Contract;
  private iface: Interface;
  private policyCache?: { at: number; value: ResalePolicy };
  private ownerFn: string;
  private checkedFn?: FunctionFragment;
  private capFn?: FunctionFragment;
  private royaltyFn?: FunctionFragment;
  readonly missingEvents: string[];

  constructor(private cfg: AppConfig, iface = loadAbi(cfg.contractAbiPath)) {
    if (!cfg.rpcUrl) throw new Error('RPC_URL is not configured');
    if (!cfg.contractAddress) throw new Error('CONTRACT_ADDRESS is not configured');
    this.iface = iface;
    this.contractAddress = getAddress(cfg.contractAddress);
    // staticNetwork avoids an extra eth_chainId round trip per request and fails clearly on a wrong network.
    this.provider = new JsonRpcProvider(cfg.rpcUrl, cfg.chainId, { staticNetwork: true, batchMaxCount: 1 });
    this.contract = new Contract(this.contractAddress, iface, this.provider);
    this.ownerFn = cfg.fn.ownerOf;
    this.checkedFn = findFn(iface, cfg.fn.checkedIn ? [cfg.fn.checkedIn] : CHECKED_IN_CANDIDATES, 1);
    this.capFn = findFn(iface, cfg.fn.capPercent ? [cfg.fn.capPercent] : CAP_CANDIDATES, 0);
    this.royaltyFn = findFn(iface, cfg.fn.royalty ? [cfg.fn.royalty] : ROYALTY_CANDIDATES, 0);
    this.missingEvents = TRACKED_EVENTS.filter((n) => !iface.getEvent(n));
  }

  async chainId() {
    try { return Number((await this.provider.getNetwork()).chainId); } catch (e) { return wrap(e); }
  }
  async blockNumber() {
    try { return await this.provider.getBlockNumber(); } catch (e) { return wrap(e); }
  }
  async blockInfo(n: number) {
    try {
      const b = await this.provider.getBlock(n);
      return b ? { hash: b.hash as string, timestamp: b.timestamp } : null;
    } catch (e) { return wrap(e); }
  }

  async getLogs(fromBlock: number, toBlock: number): Promise<RawLog[]> {
    const topics = TRACKED_EVENTS.map((n) => this.iface.getEvent(n)?.topicHash).filter(Boolean) as string[];
    if (topics.length === 0) return [];
    let logs: Log[];
    try {
      logs = await this.provider.getLogs({ address: this.contractAddress, fromBlock, toBlock, topics: [topics] });
    } catch (e) { return wrap(e); }
    const out: RawLog[] = [];
    for (const l of logs) {
      const parsed = this.iface.parseLog({ topics: [...l.topics], data: l.data });
      if (!parsed) continue;
      const args: Record<string, string | boolean> = {};
      parsed.fragment.inputs.forEach((inp, i) => {
        const v = parsed.args[i];
        args[inp.name || `arg${i}`] = typeof v === 'bigint' ? v.toString() : typeof v === 'boolean' ? v : String(v);
      });
      out.push({ blockNumber: l.blockNumber, blockHash: l.blockHash, txHash: l.transactionHash, logIndex: l.index, eventName: parsed.name, args });
    }
    return out;
  }

  async ownerOf(tokenId: string): Promise<string | null> {
    try {
      return getAddress(await this.contract.getFunction(this.ownerFn)(BigInt(tokenId)));
    } catch (e) {
      if (isCallException(e)) return null; // ERC721NonexistentToken / revert => token does not exist
      return wrap(e);
    }
  }

  async isCheckedIn(tokenId: string): Promise<boolean | null> {
    if (!this.checkedFn) return null;
    try {
      return Boolean(await this.contract.getFunction(this.checkedFn.name)(BigInt(tokenId)));
    } catch (e) {
      return wrap(e);
    }
  }

  async resalePolicy(): Promise<ResalePolicy> {
    if (this.policyCache && Date.now() - this.policyCache.at < 60_000) return this.policyCache.value;
    const read = async (fn?: FunctionFragment): Promise<number | null> => {
      if (!fn) return null;
      try {
        const v = Number(await this.contract.getFunction(fn.name)());
        return /bps|basispoints/i.test(fn.name) ? v / 100 : v;
      } catch (e) { return wrap(e); }
    };
    const cap = await read(this.capFn);
    const roy = await read(this.royaltyFn);
    const value: ResalePolicy = {
      capPercent: cap ?? this.cfg.fallbackCapPercent ?? null,
      capSource: cap !== null ? 'contract' : this.cfg.fallbackCapPercent !== undefined ? 'config-fallback' : 'unavailable',
      royaltyPercent: roy ?? this.cfg.fallbackRoyaltyPercent ?? null,
      royaltySource: roy !== null ? 'contract' : this.cfg.fallbackRoyaltyPercent !== undefined ? 'config-fallback' : 'unavailable',
    };
    this.policyCache = { at: Date.now(), value };
    return value;
  }
}
