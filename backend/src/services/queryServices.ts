import { formatEther, getAddress, isAddress } from 'ethers';
import type { DB } from '../db/database.js';
import { getState } from '../db/database.js';
import type { AppConfig } from '../config.js';
import type { ChainReader, EventInfo } from '../chain/ChainReader.js';
import { HttpError } from '../errors.js';
import type { MetadataService } from './metadataService.js';

const eth = (wei: string | null | undefined) => (wei === null || wei === undefined ? null : formatEther(BigInt(wei)));
const isoDate = (v: string | null | undefined) => (v && /^\d{9,11}$/.test(v) ? new Date(Number(v) * 1000).toISOString() : v ?? null);
async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}
interface EventRow {
  event_id: string; name: string | null; event_date: string | null; venue: string | null; organizer: string | null;
  face_value_wei: string | null; max_supply: string | null; sold_count: string | null; cap_percent: number | null;
  royalty_percent: number | null; metadata_uri: string | null; created_block: number; created_tx: string;
  detail_name?: string | null; detail_date?: string | null; detail_venue?: string | null; detail_uri?: string | null; image_uri?: string | null;
}

export class QueryServices {
  constructor(private db: DB, private chain: ChainReader, private cfg: AppConfig, private metadata: MetadataService) {}
  indexedUpTo(): number | null { const v = getState(this.db, 'last_processed_block'); return v === undefined ? null : Number(v); }

  private shapeEvent(r: EventRow, minted: number, metadata: unknown, chainEvent?: EventInfo | null) {
    const supply = chainEvent?.supply ?? r.max_supply;
    const sold = chainEvent?.sold ?? r.sold_count ?? String(minted);
    const face = chainEvent?.faceValueWei ?? r.face_value_wei;
    const max = supply !== null ? BigInt(supply) : null;
    const soldBig = BigInt(sold ?? String(minted));
    return {
      eventId: r.event_id,
      name: r.name ?? r.detail_name ?? null,
      date: isoDate(chainEvent?.date ?? r.event_date ?? r.detail_date),
      venue: r.venue ?? r.detail_venue ?? null,
      organizer: chainEvent?.organizer ?? r.organizer,
      faceValueWei: face,
      faceValueEth: eth(face),
      totalSupply: supply,
      ticketsSold: Number(soldBig),
      remainingSupply: max === null ? null : (max > soldBig ? (max - soldBig).toString() : '0'),
      capPercent: chainEvent?.capPercent ?? r.cap_percent,
      royaltyPercent: chainEvent?.royaltyPercent ?? r.royalty_percent,
      metadataUri: r.detail_uri ?? r.metadata_uri ?? null,
      imageUri: r.image_uri ?? null,
      metadata,
      createdBlock: r.created_block,
      createdTx: r.created_tx,
    };
  }

  listEvents(page: number, pageSize: number) {
    const total = (this.db.prepare('SELECT COUNT(*) c FROM events').get() as { c: number }).c;
    const rows = this.db.prepare(
      `SELECT e.*, (SELECT COUNT(*) FROM tickets t WHERE t.event_id = e.event_id) AS minted,
        d.event_name AS detail_name, d.event_date AS detail_date, d.venue AS detail_venue,
        d.metadata_uri AS detail_uri, d.image_uri AS image_uri
       FROM events e LEFT JOIN event_details d ON d.event_id=e.event_id
       ORDER BY CAST(e.event_id AS INTEGER) LIMIT ? OFFSET ?`,
    ).all(pageSize, (page - 1) * pageSize) as Array<EventRow & { minted: number }>;
    // This listing endpoint is backed by the persistent index. Security-sensitive ownership,
    // check-in and listing queries below additionally consult live on-chain state.
    return { page, pageSize, total, indexedUpToBlock: this.indexedUpTo(), events: rows.map((r) => this.shapeEvent(r, r.minted, this.metadata.cachedOnly(r.detail_uri ?? r.metadata_uri))) };
  }

  async getEvent(eventId: string) {
    const r = this.db.prepare(
      `SELECT e.*, d.event_name AS detail_name, d.event_date AS detail_date, d.venue AS detail_venue,
        d.metadata_uri AS detail_uri, d.image_uri AS image_uri FROM events e LEFT JOIN event_details d ON d.event_id=e.event_id WHERE e.event_id=?`,
    ).get(eventId) as EventRow | undefined;
    if (!r) throw new HttpError(404, 'Event not found', 'EVENT_NOT_FOUND');
    const [tickets, chainEvent] = await Promise.all([
      this.db.prepare('SELECT token_id, owner, token_uri, status FROM tickets WHERE event_id=? ORDER BY CAST(token_id AS INTEGER) LIMIT 500').all(eventId) as Array<{ token_id: string; owner: string | null; token_uri: string | null; status: string }>,
      this.chain.eventInfo(eventId),
    ]);
    const listed = new Set((this.db.prepare(`SELECT token_id FROM listings WHERE status='active' AND event_id=?`).all(eventId) as Array<{ token_id: string }>).map((x) => x.token_id));
    const uri = r.detail_uri ?? r.metadata_uri;
    const metadata = await this.metadata.resolve(uri);
    return {
      ...this.shapeEvent(r, tickets.length, metadata, chainEvent), indexedUpToBlock: this.indexedUpTo(),
      tickets: await mapLimit(tickets, 5, async (t) => {
        const [owner, used, listingPrice] = await Promise.all([this.chain.ownerOf(t.token_id), this.chain.isCheckedIn(t.token_id), this.chain.listingPrice(t.token_id)]);
        if (used === null) throw new HttpError(503, 'Cannot verify ticket usage on-chain', 'CANNOT_VERIFY_TICKET_STATUS');
        const live = owner !== null;
        const listedLive = listingPrice !== '0' && listed.has(t.token_id);
        return { ticketId: t.token_id, indexedOwner: t.owner, owner, tokenUri: t.token_uri ?? await this.chain.tokenURI(t.token_id), status: !live ? 'invalid' : used ? 'used' : listedLive ? 'listed' : 'valid' };
      }),
    };
  }

  async activeListings(page: number, pageSize: number) {
    const rows = this.db.prepare(
      `SELECT l.*, e.name AS ev_name, e.event_date AS ev_date, e.venue AS ev_venue, e.face_value_wei AS face,
        e.organizer AS ev_org, e.cap_percent AS db_cap, e.royalty_percent AS db_royalty,
        d.event_name AS detail_name, d.event_date AS detail_date, d.venue AS detail_venue,
        t.status AS ticket_status, t.event_id AS t_event
       FROM listings l LEFT JOIN tickets t ON t.token_id=l.token_id
       LEFT JOIN events e ON e.event_id=COALESCE(l.event_id,t.event_id)
       LEFT JOIN event_details d ON d.event_id=COALESCE(l.event_id,t.event_id)
       WHERE l.status='active' ORDER BY l.listed_block DESC,l.id DESC`,
    ).all() as Array<Record<string, any>>;
    const verified = await mapLimit(rows, 4, async (r) => {
      const [owner, currentPrice, used, eventIdGuess] = await Promise.all([
        this.chain.ownerOf(String(r.token_id)), this.chain.listingPrice(String(r.token_id)), this.chain.isCheckedIn(String(r.token_id)), this.chain.ticketEvent(String(r.token_id)),
      ]);
      if (owner === null || currentPrice === '0' || used === null || used) return null;
      if (eventIdGuess === null) return null;
      // TicketNFT does not escrow listings; while listed, the current owner must still equal the logged seller.
      if (!this.cfg.listingEscrow && (!r.seller || owner.toLowerCase() !== getAddress(String(r.seller)).toLowerCase())) return null;
      const event = await this.chain.eventInfo(eventIdGuess);
      if (!event) return null;
      const cap = await this.chain.maxResalePrice(String(r.token_id));
      const face = BigInt(event.faceValueWei);
      const price = BigInt(currentPrice);
      const royalty = price * BigInt(event.royaltyPercent) / 100n;
      return { row: r, owner, eventId: eventIdGuess, event, price, face, max: BigInt(cap), royalty };
    });
    const live = verified.filter((x): x is NonNullable<typeof x> => x !== null);
    const total = live.length;
    const slice = live.slice((page - 1) * pageSize, page * pageSize);
    return {
      page, pageSize, total, indexedUpToBlock: this.indexedUpTo(),
      listings: slice.map(({ row: r, owner, eventId, event, price, face, max, royalty }) => ({
        ticketId: String(r.token_id),
        event: { eventId, name: r.ev_name ?? r.detail_name ?? null, date: isoDate(event.date ?? r.ev_date ?? r.detail_date), venue: r.ev_venue ?? r.detail_venue ?? null, organizer: event.organizer },
        seller: owner,
        faceValueWei: face.toString(), faceValueEth: formatEther(face),
        resalePriceWei: price.toString(), resalePriceEth: formatEther(price),
        maxResalePriceWei: max.toString(), maxResalePriceEth: formatEther(max), withinCap: price <= max,
        capPercent: event.capPercent, capSource: 'contract', royaltyPercent: event.royaltyPercent,
        royaltyWei: royalty.toString(), royaltySource: 'contract', listedBlock: r.listed_block, listedTx: r.listed_tx,
      })),
    };
  }

  async ticketsOf(address: string) {
    if (!isAddress(address)) throw new HttpError(400, 'Invalid wallet address', 'INVALID_ADDRESS');
    const addr = getAddress(address);
    // Scan indexed ticket IDs rather than filtering only by old indexed owner, so recent resale ownership changes are observed.
    const candidates = this.db.prepare(
      `SELECT t.*, e.name AS ev_name, e.event_date AS ev_date, e.venue AS ev_venue, e.face_value_wei AS face,
        d.event_name AS detail_name, d.event_date AS detail_date, d.venue AS detail_venue
       FROM tickets t LEFT JOIN events e ON e.event_id=t.event_id LEFT JOIN event_details d ON d.event_id=t.event_id
       ORDER BY CAST(t.token_id AS INTEGER) LIMIT 3000`,
    ).all() as Array<Record<string, any>>;
    const out = await mapLimit(candidates, 5, async (t) => {
      const [owner, used, currentEventId, currentUri, listingPrice] = await Promise.all([
        this.chain.ownerOf(String(t.token_id)), this.chain.isCheckedIn(String(t.token_id)), this.chain.ticketEvent(String(t.token_id)),
        this.chain.tokenURI(String(t.token_id)), this.chain.listingPrice(String(t.token_id)),
      ]);
      if (!owner || owner.toLowerCase() !== addr.toLowerCase()) return null;
      if (used === null) throw new HttpError(503, 'Cannot verify ticket usage on-chain', 'CANNOT_VERIFY_TICKET_STATUS');
      const eventId = currentEventId ?? String(t.event_id ?? '');
      const listing = listingPrice !== '0';
      return {
        ticketId: String(t.token_id),
        event: { eventId, name: t.ev_name ?? t.detail_name ?? null, date: isoDate(t.ev_date ?? t.detail_date), venue: t.ev_venue ?? t.detail_venue ?? null, faceValueWei: t.face ?? null },
        tokenUri: currentUri ?? t.token_uri ?? null,
        metadata: await this.metadata.resolve(currentUri ?? t.token_uri ?? null),
        status: used ? 'used' : listing ? 'listed' : 'valid',
        valid: !used, listed: !used && listing,
        listingPriceWei: !used && listing ? listingPrice : null,
        ownerVerifiedOnChain: true, statusSource: 'chain',
      };
    });
    return { address: addr, indexedUpToBlock: this.indexedUpTo(), tickets: out.filter(Boolean) };
  }
}
