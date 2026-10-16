import { getAddress, id } from 'ethers';
import { ChainUnavailableError, HttpError } from '../errors.js';
import type { ChainReader, CheckinTransaction, EventInfo, RawLog, ResalePolicy } from '../chain/ChainReader.js';

/** In-memory chain used by tests and `npm run demo`. It mirrors the TicketNFT methods used by the API. */
export class FakeChain implements ChainReader {
  contractAddress = getAddress('0x00000000000000000000000000000000000fa1c3');
  id = 11155111;
  head = 0;
  salt = 0;
  blocks = new Map<number, { hash: string; timestamp: number }>();
  logs: RawLog[] = [];
  owners = new Map<string, string>();
  checked = new Set<string>();
  ticketEvents = new Map<string, string>();
  tokenUris = new Map<string, string>();
  listings = new Map<string, string>();
  eventRecords = new Map<string, EventInfo & { name: string; venue: string }>();
  venues = new Map<string, Set<string>>();
  hasStatusGetter = true;
  policy: ResalePolicy = { capPercent: 10, capSource: 'contract', royaltyPercent: 5, royaltySource: 'contract' };
  venueWalletAddress = getAddress('0x00000000000000000000000000000000000000a1');
  failures = 0;
  maxRange?: number;
  getLogsCalls = 0;

  constructor() { this.addBlock(); }
  private maybeFail() { if (this.failures > 0) { this.failures--; throw new ChainUnavailableError('fake rpc down'); } }
  private addBlock() {
    this.head++;
    this.blocks.set(this.head, { hash: id(`block:${this.head}:${this.salt}`), timestamp: 1_700_000_000 + this.head * 12 });
  }
  mine(events: Array<{ eventName: string; args: Record<string, string | boolean> }> = []): number {
    this.addBlock();
    const hash = this.blocks.get(this.head)!.hash;
    events.forEach((e, i) => this.logs.push({ blockNumber: this.head, blockHash: hash, txHash: id(`tx:${this.head}:${i}:${this.salt}`), logIndex: i, ...e }));
    return this.head;
  }
  mineEmpty(n: number) { for (let i = 0; i < n; i++) this.mine(); }

  createEvent(eventId: number, organizer: string, name: string, venue: string, priceWei: string, maxSupply: number, capPercent = 10, royaltyPercent = 5) {
    this.eventRecords.set(String(eventId), {
      eventId: String(eventId), organizer: getAddress(organizer), date: '1800000000', faceValueWei: priceWei,
      supply: String(maxSupply), sold: '0', capPercent, royaltyPercent, name, venue,
    });
    return this.mine([{ eventName: 'EventCreated', args: { eventId: String(eventId), organizer, name, venue, date: '1800000000', faceValue: priceWei, price: priceWei, supply: String(maxSupply), maxSupply: String(maxSupply), sold: '0', capPercent: String(capPercent), royaltyPercent: String(royaltyPercent) } }]);
  }
  mint(tokenId: number, eventId: number, to: string, uri = `ipfs://fake-metadata-${tokenId}`) {
    this.owners.set(String(tokenId), getAddress(to));
    this.ticketEvents.set(String(tokenId), String(eventId));
    this.tokenUris.set(String(tokenId), uri);
    const ev = this.eventRecords.get(String(eventId));
    if (ev) ev.sold = String(Number(ev.sold) + 1);
    return this.mine([{ eventName: 'TicketMinted', args: { ticketId: String(tokenId), tokenId: String(tokenId), eventId: String(eventId), buyer: to, price: ev?.faceValueWei ?? '0' } }]);
  }
  list(tokenId: number, seller: string, priceWei: string) {
    this.listings.set(String(tokenId), priceWei);
    return this.mine([{ eventName: 'Listed', args: { ticketId: String(tokenId), tokenId: String(tokenId), seller, price: priceWei } }]);
  }
  sell(tokenId: number, seller: string, buyer: string, priceWei: string) {
    this.owners.set(String(tokenId), getAddress(buyer));
    this.listings.delete(String(tokenId));
    return this.mine([{ eventName: 'Sold', args: { ticketId: String(tokenId), tokenId: String(tokenId), seller, buyer, price: priceWei } }]);
  }
  checkIn(tokenId: number) {
    this.checked.add(String(tokenId));
    this.listings.delete(String(tokenId));
    return this.mine([{ eventName: 'CheckedIn', args: { ticketId: String(tokenId), tokenId: String(tokenId), by: this.venueWalletAddress } }]);
  }
  authorizeVenue(eventId: string, address: string) {
    const venues = this.venues.get(eventId) ?? new Set<string>();
    venues.add(getAddress(address)); this.venues.set(eventId, venues);
    return this.mine([{ eventName: 'VenueAdded', args: { eventId, venue: getAddress(address) } }]);
  }
  reorg(toBlock: number, replacement: Array<Array<{ eventName: string; args: Record<string, string | boolean> }>> = []) {
    this.salt++;
    for (const n of [...this.blocks.keys()]) if (n > toBlock) this.blocks.delete(n);
    this.logs = this.logs.filter((l) => l.blockNumber <= toBlock);
    this.head = toBlock;
    for (const evs of replacement) this.mine(evs);
  }

  async chainId() { this.maybeFail(); return this.id; }
  async blockNumber() { this.maybeFail(); return this.head; }
  async blockInfo(n: number) { this.maybeFail(); return this.blocks.get(n) ?? null; }
  async getLogs(from: number, to: number) {
    this.maybeFail(); this.getLogsCalls++;
    if (this.maxRange !== undefined && to - from > this.maxRange) throw new ChainUnavailableError('query exceeds max block range', new Error('block range too large'));
    return this.logs.filter((l) => l.blockNumber >= from && l.blockNumber <= to).map((l) => ({ ...l, args: { ...l.args } }));
  }
  async ownerOf(tokenId: string) { this.maybeFail(); return this.owners.get(tokenId) ?? null; }
  async isCheckedIn(tokenId: string) { this.maybeFail(); return this.hasStatusGetter ? this.checked.has(tokenId) : null; }
  async ticketEvent(tokenId: string) { this.maybeFail(); return this.ticketEvents.get(tokenId) ?? null; }
  async tokenURI(tokenId: string) { this.maybeFail(); return this.tokenUris.get(tokenId) ?? null; }
  async listingPrice(tokenId: string) { this.maybeFail(); return this.listings.get(tokenId) ?? '0'; }
  async maxResalePrice(tokenId: string) {
    this.maybeFail();
    const ev = this.eventRecords.get(this.ticketEvents.get(tokenId) ?? '');
    if (!ev) throw new HttpError(404, 'Ticket/event not found', 'TICKET_NOT_FOUND');
    return ((BigInt(ev.faceValueWei) * BigInt(100 + ev.capPercent)) / 100n).toString();
  }
  async eventInfo(eventId: string) { this.maybeFail(); const e = this.eventRecords.get(eventId); return e ? { eventId: e.eventId, organizer: e.organizer, date: e.date, faceValueWei: e.faceValueWei, supply: e.supply, sold: e.sold, capPercent: e.capPercent, royaltyPercent: e.royaltyPercent } : null; }
  async isVenue(eventId: string, venueAddress: string) { this.maybeFail(); return this.venues.get(eventId)?.has(getAddress(venueAddress)) ?? false; }
  checkinSignerAddress() { return this.venueWalletAddress; }
  async submitCheckIn(ticketId: string): Promise<CheckinTransaction> {
    this.maybeFail();
    const eventId = this.ticketEvents.get(ticketId);
    const ev = eventId ? this.eventRecords.get(eventId) : undefined;
    if (!ev) throw new HttpError(404, 'Ticket does not exist', 'TICKET_NOT_FOUND');
    if (ev.organizer !== this.venueWalletAddress && !(await this.isVenue(eventId!, this.venueWalletAddress))) throw new HttpError(403, 'Venue not authorized', 'VENUE_NOT_AUTHORIZED');
    if (this.checked.has(ticketId)) throw new HttpError(409, 'Already used', 'ALREADY_USED');
    const blockNumber = this.checkIn(Number(ticketId));
    const log = this.logs[this.logs.length - 1];
    return { txHash: log.txHash, blockNumber, status: 'confirmed', venueAddress: this.venueWalletAddress };
  }
  async deploymentBlock() { return null; }
  async resalePolicy() { this.maybeFail(); return this.policy; }
}
