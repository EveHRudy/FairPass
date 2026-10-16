import { getAddress, id } from 'ethers';
import { ChainUnavailableError } from '../errors.js';
import type { ChainReader, RawLog, ResalePolicy } from '../chain/ChainReader.js';

/** In-memory chain used by tests and `npm run demo`. Mirrors the ChainReader contract exactly. */
export class FakeChain implements ChainReader {
  contractAddress = getAddress('0x00000000000000000000000000000000000fa1c3');
  id = 11155111;
  head = 0;
  salt = 0;
  blocks = new Map<number, { hash: string; timestamp: number }>();
  logs: RawLog[] = [];
  owners = new Map<string, string>();
  checked = new Set<string>();
  hasStatusGetter = true;
  policy: ResalePolicy = { capPercent: 10, capSource: 'contract', royaltyPercent: 5, royaltySource: 'contract' };
  /** number of upcoming calls that should fail like a dead RPC */
  failures = 0;
  /** if set, getLogs throws a range error while (to-from) exceeds this */
  maxRange?: number;
  getLogsCalls = 0;

  constructor() { this.addBlock(); }

  private maybeFail() {
    if (this.failures > 0) { this.failures--; throw new ChainUnavailableError('fake rpc down'); }
  }
  private addBlock() {
    this.head++;
    this.blocks.set(this.head, { hash: id(`block:${this.head}:${this.salt}`), timestamp: 1_700_000_000 + this.head * 12 });
  }
  /** Mines one block containing the given events. */
  mine(events: Array<{ eventName: string; args: Record<string, string | boolean> }> = []): number {
    this.addBlock();
    const hash = this.blocks.get(this.head)!.hash;
    events.forEach((e, i) =>
      this.logs.push({ blockNumber: this.head, blockHash: hash, txHash: id(`tx:${this.head}:${i}:${this.salt}`), logIndex: i, ...e }));
    return this.head;
  }
  mineEmpty(n: number) { for (let i = 0; i < n; i++) this.mine(); }

  // ---- contract-like helpers (mutate state AND emit the event) ----
  createEvent(eventId: number, organizer: string, name: string, venue: string, priceWei: string, maxSupply: number) {
    return this.mine([{ eventName: 'EventCreated', args: { eventId: String(eventId), organizer, name, venue, date: '1800000000', price: priceWei, maxSupply: String(maxSupply) } }]);
  }
  mint(tokenId: number, eventId: number, to: string) {
    this.owners.set(String(tokenId), getAddress(to));
    return this.mine([{ eventName: 'TicketMinted', args: { tokenId: String(tokenId), eventId: String(eventId), to } }]);
  }
  list(tokenId: number, seller: string, priceWei: string) {
    return this.mine([{ eventName: 'Listed', args: { tokenId: String(tokenId), seller, price: priceWei } }]);
  }
  sell(tokenId: number, seller: string, buyer: string, priceWei: string) {
    this.owners.set(String(tokenId), getAddress(buyer));
    return this.mine([{ eventName: 'Sold', args: { tokenId: String(tokenId), seller, buyer, price: priceWei } }]);
  }
  checkIn(tokenId: number) {
    this.checked.add(String(tokenId));
    return this.mine([{ eventName: 'CheckedIn', args: { tokenId: String(tokenId) } }]);
  }
  /** Replaces every block above `toBlock` (simulates a chain reorganisation). */
  reorg(toBlock: number, replacement: Array<Array<{ eventName: string; args: Record<string, string | boolean> }>> = []) {
    this.salt++;
    for (const n of [...this.blocks.keys()]) if (n > toBlock) this.blocks.delete(n);
    this.logs = this.logs.filter((l) => l.blockNumber <= toBlock);
    this.head = toBlock;
    for (const evs of replacement) this.mine(evs);
  }

  // ---- ChainReader ----
  async chainId() { this.maybeFail(); return this.id; }
  async blockNumber() { this.maybeFail(); return this.head; }
  async blockInfo(n: number) { this.maybeFail(); return this.blocks.get(n) ?? null; }
  async getLogs(from: number, to: number) {
    this.maybeFail();
    this.getLogsCalls++;
    if (this.maxRange !== undefined && to - from > this.maxRange) throw new ChainUnavailableError('query exceeds max block range', new Error('block range too large'));
    return this.logs.filter((l) => l.blockNumber >= from && l.blockNumber <= to).map((l) => ({ ...l, args: { ...l.args } }));
  }
  async ownerOf(tokenId: string) { this.maybeFail(); return this.owners.get(tokenId) ?? null; }
  async isCheckedIn(tokenId: string) { this.maybeFail(); return this.hasStatusGetter ? this.checked.has(tokenId) : null; }
  async resalePolicy() { this.maybeFail(); return this.policy; }
}
