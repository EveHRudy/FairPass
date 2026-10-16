import { formatEther, getAddress, isAddress } from 'ethers';
import type { DB } from '../db/database.js';
import { getState } from '../db/database.js';
import type { AppConfig } from '../config.js';
import type { ChainReader } from '../chain/ChainReader.js';
import { HttpError } from '../errors.js';
import type { MetadataService } from './metadataService.js';

const eth = (wei: string | null) => (wei === null || wei === undefined ? null : formatEther(BigInt(wei)));
const isoDate = (v: string | null) => (v && /^\d{9,11}$/.test(v) ? new Date(Number(v) * 1000).toISOString() : v);

/** Runs `fn` over items with bounded concurrency (keeps RPC usage polite). */
async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

interface EventRow {
  event_id: string; name: string | null; event_date: string | null; venue: string | null; organizer: string | null;
  face_value_wei: string | null; max_supply: string | null; metadata_uri: string | null; created_block: number; created_tx: string;
}

export class QueryServices {
  constructor(private db: DB, private chain: ChainReader, private cfg: AppConfig, private metadata: MetadataService) {}

  indexedUpTo(): number | null {
    const v = getState(this.db, 'last_processed_block');
    return v === undefined ? null : Number(v);
  }

  private shapeEvent(r: EventRow, minted: number, metadata: unknown) {
    const max = r.max_supply !== null ? BigInt(r.max_supply) : null;
    return {
      eventId: r.event_id, name: r.name, date: isoDate(r.event_date), venue: r.venue, organizer: r.organizer,
      faceValueWei: r.face_value_wei, faceValueEth: eth(r.face_value_wei),
      totalSupply: r.max_supply, ticketsSold: minted,
      remainingSupply: max === null ? null : (max > BigInt(minted) ? (max - BigInt(minted)).toString() : '0'),
      metadataUri: r.metadata_uri, metadata,
      createdBlock: r.created_block, createdTx: r.created_tx,
    };
  }

  listEvents(page: number, pageSize: number) {
    const total = (this.db.prepare('SELECT COUNT(*) c FROM events').get() as { c: number }).c;
    const rows = this.db.prepare(
      `SELECT e.*, (SELECT COUNT(*) FROM tickets t WHERE t.event_id = e.event_id) AS minted
       FROM events e ORDER BY CAST(e.event_id AS INTEGER) LIMIT ? OFFSET ?`,
    ).all(pageSize, (page - 1) * pageSize) as Array<EventRow & { minted: number }>;
    return {
      page, pageSize, total, indexedUpToBlock: this.indexedUpTo(),
      events: rows.map((r) => this.shapeEvent(r, r.minted, this.metadata.cachedOnly(r.metadata_uri))),
    };
  }

  async getEvent(eventId: string) {
    const r = this.db.prepare('SELECT * FROM events WHERE event_id=?').get(eventId) as EventRow | undefined;
    if (!r) throw new HttpError(404, 'Event not found', 'EVENT_NOT_FOUND');
    const tickets = this.db.prepare('SELECT token_id, owner, token_uri, status FROM tickets WHERE event_id=? ORDER BY CAST(token_id AS INTEGER) LIMIT 500').all(eventId) as
      Array<{ token_id: string; owner: string | null; token_uri: string | null; status: string }>;
    const listed = new Set((this.db.prepare(`SELECT token_id FROM listings WHERE status='active' AND event_id=?`).all(eventId) as Array<{ token_id: string }>).map((x) => x.token_id));
    const metadata = await this.metadata.resolve(r.metadata_uri);
    return {
      ...this.shapeEvent(r, tickets.length, metadata),
      indexedUpToBlock: this.indexedUpTo(),
      tickets: tickets.map((t) => ({
        ticketId: t.token_id, indexedOwner: t.owner, tokenUri: t.token_uri,
        status: t.status === 'checked_in' ? 'used' : listed.has(t.token_id) ? 'listed' : 'valid',
      })),
    };
  }

  async activeListings(page: number, pageSize: number) {
    const rows = this.db.prepare(
      `SELECT l.*, e.name AS ev_name, e.event_date AS ev_date, e.venue AS ev_venue, e.face_value_wei AS face, e.organizer AS ev_org,
              t.status AS ticket_status, t.event_id AS t_event
       FROM listings l LEFT JOIN tickets t ON t.token_id = l.token_id LEFT JOIN events e ON e.event_id = COALESCE(l.event_id, t.event_id)
       WHERE l.status='active' ORDER BY l.listed_block DESC, l.id DESC`,
    ).all() as Array<Record<string, any>>;

    const policy = await this.chain.resalePolicy();
    // Never trust the index alone: confirm on-chain ownership / check-in state for each candidate.
    const verified = await mapLimit(rows, 5, async (r) => {
      const owner = await this.chain.ownerOf(r.token_id);
      if (owner === null) return null;
      const holderOk = this.cfg.listingEscrow ? owner === this.chain.contractAddress : r.seller && owner === getAddress(r.seller);
      if (!holderOk) return null;
      const onChain = await this.chain.isCheckedIn(r.token_id);
      if ((onChain ?? r.ticket_status === 'checked_in')) return null;
      return r;
    });
    const live = verified.filter((x): x is Record<string, any> => x !== null);
    const slice = live.slice((page - 1) * pageSize, page * pageSize);

    const listings = slice.map((r) => {
      const price = BigInt(r.price_wei);
      const face = r.face !== null && r.face !== undefined ? BigInt(r.face) : null;
      const max = face !== null && policy.capPercent !== null ? (face * BigInt(Math.round((100 + policy.capPercent) * 100))) / 10000n : null;
      const royalty = policy.royaltyPercent !== null ? (price * BigInt(Math.round(policy.royaltyPercent * 100))) / 10000n : null;
      return {
        ticketId: r.token_id,
        event: { eventId: r.event_id ?? r.t_event ?? null, name: r.ev_name ?? null, date: isoDate(r.ev_date ?? null), venue: r.ev_venue ?? null, organizer: r.ev_org ?? null },
        seller: r.seller,
        faceValueWei: face?.toString() ?? null, faceValueEth: face !== null ? formatEther(face) : null,
        resalePriceWei: price.toString(), resalePriceEth: formatEther(price),
        maxResalePriceWei: max?.toString() ?? null, maxResalePriceEth: max !== null ? formatEther(max) : null,
        withinCap: max === null ? null : price <= max,
        capPercent: policy.capPercent, capSource: policy.capSource,
        royaltyPercent: policy.royaltyPercent, royaltyWei: royalty?.toString() ?? null, royaltySource: policy.royaltySource,
        listedBlock: r.listed_block, listedTx: r.listed_tx,
      };
    });
    return { page, pageSize, total: live.length, indexedUpToBlock: this.indexedUpTo(), listings };
  }

  async ticketsOf(address: string) {
    if (!isAddress(address)) throw new HttpError(400, 'Invalid wallet address', 'INVALID_ADDRESS');
    const addr = getAddress(address);
    const candidates = this.db.prepare(
      `SELECT t.*, e.name AS ev_name, e.event_date AS ev_date, e.venue AS ev_venue, e.face_value_wei AS face
       FROM tickets t LEFT JOIN events e ON e.event_id = t.event_id
       WHERE t.owner = ? COLLATE NOCASE OR t.token_id IN (SELECT token_id FROM listings WHERE status='active' AND seller = ? COLLATE NOCASE)
       ORDER BY CAST(t.token_id AS INTEGER)`,
    ).all(addr, addr) as Array<Record<string, any>>;
    const activeListings = new Map((this.db.prepare(`SELECT token_id, price_wei FROM listings WHERE status='active'`).all() as Array<{ token_id: string; price_wei: string }>).map((x) => [x.token_id, x.price_wei]));

    const out = await mapLimit(candidates, 5, async (t) => {
      const owner = await this.chain.ownerOf(t.token_id);
      const ownedByUser = owner === addr || (this.cfg.listingEscrow && owner === this.chain.contractAddress && activeListings.has(t.token_id));
      if (!ownedByUser) return null;
      const onChain = await this.chain.isCheckedIn(t.token_id);
      const used = onChain ?? t.status === 'checked_in';
      const listed = !used && activeListings.has(t.token_id);
      return {
        ticketId: t.token_id,
        event: { eventId: t.event_id, name: t.ev_name, date: isoDate(t.ev_date), venue: t.ev_venue, faceValueWei: t.face },
        tokenUri: t.token_uri,
        metadata: await this.metadata.resolve(t.token_uri),
        status: used ? 'used' : listed ? 'listed' : 'valid',
        valid: !used,
        listed,
        listingPriceWei: listed ? activeListings.get(t.token_id) : null,
        ownerVerifiedOnChain: true,
        statusSource: onChain === null ? 'index' : 'chain',
      };
    });
    return { address: addr, indexedUpToBlock: this.indexedUpTo(), tickets: out.filter(Boolean) };
  }
}
