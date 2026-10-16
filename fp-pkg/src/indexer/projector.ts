import type { DB } from '../db/database.js';
import { DERIVED_TABLES } from '../db/database.js';
import { ArgMap } from './argMap.js';

export interface StoredEvent {
  id: number;
  event_name: string;
  block_number: number;
  block_time: number | null;
  tx_hash: string;
  log_index: number;
  args: Record<string, string | boolean>;
}

const CANCEL_EVENTS = new Set(['ListingCancelled', 'Cancelled', 'Delisted']);

/** Applies one raw event to the derived tables. Pure SQL, deterministic, safe to replay. */
export function project(db: DB, ev: StoredEvent, map: ArgMap): void {
  const a = ev.args;
  const pick = (f: Parameters<ArgMap['pick']>[1]) => map.pick(a, f);

  switch (ev.event_name) {
    case 'EventCreated': {
      const eventId = pick('eventId');
      if (eventId === undefined) return;
      db.prepare(
        `INSERT INTO events (event_id, name, event_date, venue, organizer, face_value_wei, max_supply, metadata_uri, created_block, created_tx)
         VALUES (?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(event_id) DO UPDATE SET name=excluded.name, event_date=excluded.event_date, venue=excluded.venue,
           organizer=excluded.organizer, face_value_wei=excluded.face_value_wei, max_supply=excluded.max_supply,
           metadata_uri=excluded.metadata_uri, created_block=excluded.created_block, created_tx=excluded.created_tx`,
      ).run(eventId, pick('name') ?? null, pick('date') ?? null, pick('venue') ?? null, pick('organizer') ?? null,
        pick('price') ?? null, pick('maxSupply') ?? null, pick('metadataURI') ?? null, ev.block_number, ev.tx_hash);
      return;
    }
    case 'TicketMinted': {
      const tokenId = pick('tokenId');
      if (tokenId === undefined) return;
      db.prepare(
        `INSERT INTO tickets (token_id, event_id, owner, token_uri, status, last_price_wei, minted_block, minted_tx)
         VALUES (?,?,?,?, 'valid', ?, ?, ?)
         ON CONFLICT(token_id) DO UPDATE SET event_id=COALESCE(excluded.event_id, tickets.event_id), owner=excluded.owner,
           token_uri=COALESCE(excluded.token_uri, tickets.token_uri), minted_block=excluded.minted_block, minted_tx=excluded.minted_tx`,
      ).run(tokenId, pick('eventId') ?? null, pick('owner') ?? pick('buyer') ?? null, pick('tokenURI') ?? null,
        pick('price') ?? null, ev.block_number, ev.tx_hash);
      return;
    }
    case 'Listed': {
      const tokenId = pick('tokenId');
      const price = pick('price');
      if (tokenId === undefined || price === undefined) return;
      // A newer listing replaces any older active one for the same token.
      db.prepare(`UPDATE listings SET status='superseded' WHERE token_id=? AND status='active'`).run(tokenId);
      const t = db.prepare('SELECT event_id, owner FROM tickets WHERE token_id=?').get(tokenId) as { event_id: string | null; owner: string | null } | undefined;
      db.prepare(
        `INSERT OR IGNORE INTO listings (token_id, event_id, seller, price_wei, status, listed_block, listed_tx, listed_log_index)
         VALUES (?,?,?,?, 'active', ?, ?, ?)`,
      ).run(tokenId, pick('eventId') ?? t?.event_id ?? null, pick('seller') ?? t?.owner ?? null, price, ev.block_number, ev.tx_hash, ev.log_index);
      return;
    }
    case 'Sold': {
      const tokenId = pick('tokenId');
      if (tokenId === undefined) return;
      const buyer = pick('buyer') ?? null;
      const price = pick('price') ?? null;
      db.prepare(`UPDATE listings SET status='sold', closed_tx=?, buyer=? WHERE token_id=? AND status='active'`).run(ev.tx_hash, buyer, tokenId);
      db.prepare(`UPDATE tickets SET owner=COALESCE(?, owner), last_price_wei=COALESCE(?, last_price_wei) WHERE token_id=?`).run(buyer, price, tokenId);
      return;
    }
    case 'CheckedIn': {
      const tokenId = pick('tokenId');
      if (tokenId === undefined) return;
      db.prepare(`UPDATE tickets SET status='checked_in', checked_in_tx=?, checked_in_block=? WHERE token_id=?`).run(ev.tx_hash, ev.block_number, tokenId);
      db.prepare(`UPDATE listings SET status='invalidated', closed_tx=? WHERE token_id=? AND status='active'`).run(ev.tx_hash, tokenId);
      return;
    }
    default:
      if (CANCEL_EVENTS.has(ev.event_name)) {
        const tokenId = pick('tokenId');
        if (tokenId !== undefined) db.prepare(`UPDATE listings SET status='cancelled', closed_tx=? WHERE token_id=? AND status='active'`).run(ev.tx_hash, tokenId);
      }
  }
}

export function loadStoredEvents(db: DB): StoredEvent[] {
  const rows = db.prepare('SELECT * FROM chain_events ORDER BY block_number, log_index').all() as Array<Record<string, any>>;
  return rows.map((r) => ({ ...(r as any), args: JSON.parse(r.args_json) }));
}

/** Drops all derived rows and rebuilds them from the raw event log (used after a reorg rollback). */
export function rebuildProjections(db: DB, map: ArgMap): void {
  for (const t of DERIVED_TABLES) db.exec(`DELETE FROM ${t}`);
  for (const ev of loadStoredEvents(db)) project(db, ev, map);
}
