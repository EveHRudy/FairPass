import { Contract, Interface, JsonRpcProvider, Wallet, getAddress, type Fragment, type FunctionFragment, type Log, isAddress } from 'ethers';
import fs from 'node:fs';
import type { AppConfig } from '../config.js';
import { ChainUnavailableError, HttpError } from '../errors.js';
import type { ChainReader, CheckinTransaction, EventInfo, RawLog, ResalePolicy } from './ChainReader.js';

/** Events that exist in the deployed TicketNFT ABI. Optional events are included only if declared. */
export const TRACKED_EVENTS = [
  'EventCreated', 'TicketMinted', 'Listed', 'ListingCancelled', 'Sold', 'CheckedIn', 'Withdrawn', 'VenueAdded', 'VenueRemoved',
  'Cancelled', 'Delisted',
] as const;
const CHECKED_IN_CANDIDATES = ['isCheckedIn', 'checkedIn', 'isUsed', 'ticketUsed', 'usedTickets', 'used', 'hasCheckedIn'];
const CAP_CANDIDATES = ['maxResaleCapPercent', 'resaleCapPercent', 'capPercent', 'maxResalePercent', 'priceCapPercent', 'resaleCap'];
const ROYALTY_CANDIDATES = ['royaltyPercent', 'royaltyPercentage', 'organizerRoyaltyPercent', 'royaltyBps', 'royaltyBasisPoints'];

export function loadAbi(abiPath: string): Interface {
  if (!fs.existsSync(abiPath)) throw new Error(`Contract ABI/deployment artifact was not found: ${abiPath}`);
  const raw = JSON.parse(fs.readFileSync(abiPath, 'utf8')) as { abi?: unknown } | unknown[];
  const abi = Array.isArray(raw) ? raw : (raw as { abi?: unknown }).abi;
  if (!Array.isArray(abi)) throw new Error(`No ABI array found in ${abiPath}`);
  return new Interface(abi as any[]);
}

function findFn(iface: Interface, names: string[], inputs: number): FunctionFragment | undefined {
  return iface.fragments.find((x: Fragment) => x.type === 'function'
    && names.includes((x as FunctionFragment).name)
    && (x as FunctionFragment).inputs.length === inputs
    && ['view', 'pure'].includes((x as FunctionFragment).stateMutability)) as FunctionFragment | undefined;
}
function isCallException(err: unknown): boolean {
  const e = err as { code?: string };
  return e?.code === 'CALL_EXCEPTION' || e?.code === 'BAD_DATA';
}
function wrap(err: unknown): never { throw new ChainUnavailableError('Blockchain node is temporarily unavailable', err); }

export class EthersChainReader implements ChainReader {
  readonly contractAddress: string;
  readonly iface: Interface;
  private provider: JsonRpcProvider;
  private contract: Contract;
  private policyCache?: { at: number; value: ResalePolicy };
  private ownerFn: string;
  private checkedFn?: FunctionFragment;
  private capFn?: FunctionFragment;
  private royaltyFn?: FunctionFragment;
  readonly missingEvents: string[];

  constructor(private cfg: AppConfig, iface = loadAbi(cfg.contractAbiPath)) {
    if (!cfg.rpcUrl) throw new Error('RPC_URL is not configured');
    if (!cfg.contractAddress || !isAddress(cfg.contractAddress)) throw new Error('CONTRACT_ADDRESS is not configured or invalid');
    this.iface = iface;
    this.contractAddress = getAddress(cfg.contractAddress);
    // Keep network detection enabled so the provider rejects an RPC endpoint on the wrong chain.
    this.provider = new JsonRpcProvider(cfg.rpcUrl, cfg.chainId, { staticNetwork: false, batchMaxCount: 1 });
    this.contract = new Contract(this.contractAddress, iface, this.provider);
    this.ownerFn = cfg.fn.ownerOf;
    this.checkedFn = findFn(iface, cfg.fn.checkedIn ? [cfg.fn.checkedIn] : CHECKED_IN_CANDIDATES, 1);
    this.capFn = findFn(iface, cfg.fn.capPercent ? [cfg.fn.capPercent] : CAP_CANDIDATES, 0);
    this.royaltyFn = findFn(iface, cfg.fn.royalty ? [cfg.fn.royalty] : ROYALTY_CANDIDATES, 0);
    this.missingEvents = TRACKED_EVENTS.filter((n) => !iface.getEvent(n));
    // Enforce the full deployed ABI on Sepolia; the test-only local fixture deliberately has a smaller interface.
    if (cfg.chainId === 11155111) {
      const required = ['ownerOf', 'used', 'ticketEvent', 'events', 'isVenue', 'maxResalePrice', 'listings', 'tokenURI', 'checkIn'];
      const missing = required.filter((name) => !iface.getFunction(name));
      if (missing.length) throw new Error(`The configured Sepolia ABI is not TicketNFT's deployed ABI; missing functions: ${missing.join(', ')}`);
    }
  }

  async chainId(): Promise<number> {
    try { return Number((await this.provider.getNetwork()).chainId); } catch (e) { return wrap(e); }
  }
  async blockNumber(): Promise<number> {
    try { return await this.provider.getBlockNumber(); } catch (e) { return wrap(e); }
  }
  async blockInfo(n: number) {
    try { const b = await this.provider.getBlock(n); return b ? { hash: b.hash as string, timestamp: b.timestamp } : null; }
    catch (e) { return wrap(e); }
  }
  async deploymentBlock(): Promise<number | null> {
    if (!this.cfg.deploymentTxHash) return null;
    try {
      const receipt = await this.provider.getTransactionReceipt(this.cfg.deploymentTxHash);
      return receipt?.blockNumber ?? null;
    } catch (e) { return wrap(e); }
  }

  async getLogs(fromBlock: number, toBlock: number): Promise<RawLog[]> {
    const topics = TRACKED_EVENTS.map((n) => this.iface.getEvent(n)?.topicHash).filter(Boolean) as string[];
    if (!topics.length) return [];
    let logs: Log[];
    try { logs = await this.provider.getLogs({ address: this.contractAddress, fromBlock, toBlock, topics: [topics] }); }
    catch (e) { return wrap(e); }
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
    return out.sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
  }

  async ownerOf(tokenId: string): Promise<string | null> {
    try { return getAddress(await this.contract.getFunction(this.ownerFn)(BigInt(tokenId))); }
    catch (e) { if (isCallException(e)) return null; return wrap(e); }
  }
  async isCheckedIn(tokenId: string): Promise<boolean | null> {
    if (!this.checkedFn) return null;
    try { return Boolean(await this.contract.getFunction(this.checkedFn.name)(BigInt(tokenId))); }
    catch (e) { return wrap(e); }
  }
  async ticketEvent(tokenId: string): Promise<string | null> {
    try {
      const id = BigInt(await this.contract.getFunction('ticketEvent')(BigInt(tokenId)));
      return id === 0n ? null : id.toString();
    } catch (e) { if (isCallException(e)) return null; return wrap(e); }
  }
  async tokenURI(tokenId: string): Promise<string | null> {
    try { return String(await this.contract.getFunction('tokenURI')(BigInt(tokenId))); }
    catch (e) { if (isCallException(e)) return null; return wrap(e); }
  }
  async listingPrice(tokenId: string): Promise<string> {
    try { return BigInt(await this.contract.getFunction('listings')(BigInt(tokenId))).toString(); }
    catch (e) { return wrap(e); }
  }
  async maxResalePrice(tokenId: string): Promise<string> {
    try { return BigInt(await this.contract.getFunction('maxResalePrice')(BigInt(tokenId))).toString(); }
    catch (e) { return wrap(e); }
  }
  async eventInfo(eventId: string): Promise<EventInfo | null> {
    try {
      const r = await this.contract.getFunction('events')(BigInt(eventId));
      const organizer = String(r[0]);
      if (/^0x0{40}$/i.test(organizer)) return null;
      return {
        eventId,
        organizer: getAddress(organizer),
        date: BigInt(r[1]).toString(),
        faceValueWei: BigInt(r[2]).toString(),
        supply: BigInt(r[3]).toString(),
        sold: BigInt(r[4]).toString(),
        capPercent: Number(r[5]),
        royaltyPercent: Number(r[6]),
      };
    } catch (e) { if (isCallException(e)) return null; return wrap(e); }
  }
  async isVenue(eventId: string, venueAddress: string): Promise<boolean> {
    try { return Boolean(await this.contract.getFunction('isVenue')(BigInt(eventId), getAddress(venueAddress))); }
    catch (e) { return wrap(e); }
  }
  checkinSignerAddress(): string | null {
    if (!this.cfg.venuePrivateKey) return null;
    try { return getAddress(new Wallet(this.cfg.venuePrivateKey).address); }
    catch { throw new Error('VENUE_PRIVATE_KEY is not a valid private key'); }
  }
  async submitCheckIn(ticketId: string): Promise<CheckinTransaction> {
    if (!this.cfg.venuePrivateKey) throw new HttpError(503, 'VENUE_PRIVATE_KEY is not configured; on-chain check-in confirmation is unavailable', 'CHECKIN_SIGNER_NOT_CONFIGURED');
    let signer: Wallet;
    try { signer = new Wallet(this.cfg.venuePrivateKey, this.provider); }
    catch { throw new HttpError(500, 'Configured venue private key is invalid', 'CHECKIN_SIGNER_INVALID'); }
    try {
      const signerAddress = getAddress(signer.address);
      const eventId = await this.ticketEvent(ticketId);
      if (!eventId) throw new HttpError(404, 'Ticket does not exist', 'TICKET_NOT_FOUND');
      const info = await this.eventInfo(eventId);
      if (!info) throw new HttpError(404, 'Event does not exist', 'EVENT_NOT_FOUND');
      const authorized = signerAddress === info.organizer || await this.isVenue(eventId, signerAddress);
      if (!authorized) throw new HttpError(403, 'Configured venue wallet is not authorized for this event. The organizer must call addVenue(eventId, address).', 'VENUE_NOT_AUTHORIZED');
      const tx = await this.contract.connect(signer).getFunction('checkIn')(BigInt(ticketId));
      const receipt = await tx.wait(1);
      if (!receipt || receipt.status !== 1) throw new HttpError(502, 'The check-in transaction was not confirmed successfully', 'CHECKIN_TX_FAILED');
      return { txHash: receipt.hash, blockNumber: receipt.blockNumber, status: 'confirmed', venueAddress: signerAddress };
    } catch (e) {
      if (e instanceof HttpError) throw e;
      const err = e as { code?: string; reason?: string; shortMessage?: string; message?: string };
      if (['NETWORK_ERROR', 'TIMEOUT', 'SERVER_ERROR', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND'].includes(err.code ?? '')) {
        throw new ChainUnavailableError('Blockchain RPC failed while submitting or confirming the check-in transaction', e);
      }
      // ethers includes the decoded Solidity revert reason in shortMessage/reason when available.
      const readable = err.reason ?? err.shortMessage ?? err.message ?? 'Transaction failed';
      throw new HttpError(409, readable.slice(0, 240), 'CHECKIN_TX_REVERTED');
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
    const cap = await read(this.capFn), roy = await read(this.royaltyFn);
    const value: ResalePolicy = {
      capPercent: cap ?? this.cfg.fallbackCapPercent ?? null,
      capSource: cap !== null ? 'contract' : this.cfg.fallbackCapPercent !== undefined ? 'config-fallback' : 'unavailable',
      royaltyPercent: roy ?? this.cfg.fallbackRoyaltyPercent ?? null,
      royaltySource: roy !== null ? 'contract' : this.cfg.fallbackRoyaltyPercent !== undefined ? 'config-fallback' : 'unavailable',
    };
    this.policyCache = { at: Date.now(), value };
    return value;
  }
  async getBalance(address: string): Promise<string> {
    try {
      const b = await this.provider.getBalance(getAddress(address));
      return b.toString();
    } catch (e) {
      return wrap(e);
    }
  }
}
