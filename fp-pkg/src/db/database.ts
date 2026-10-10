import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export type DB = Database.Database;

/** Schema is idempotent (CREATE IF NOT EXISTS) and versioned through PRAGMA user_version. */
const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS indexer_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Block hashes recorded at the end of every processed batch (used for reorg detection).
CREATE TABLE IF NOT EXISTS block_hashes (
  block_number INTEGER PRIMARY KEY,
  block_hash   TEXT NOT NULL
);

-- Raw decoded logs. UNIQUE(tx_hash, log_index) makes re-processing idempotent.
CREATE TABLE IF NOT EXISTS chain_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  event_name   TEXT NOT NULL,
  block_number INTEGER NOT NULL,
  block_hash   TEXT NOT NULL,
  block_time   INTEGER,
  tx_hash      TEXT NOT NULL,
  log_index    INTEGER NOT NULL,
  args_json    TEXT NOT NULL,
  UNIQUE (tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS idx_chain_events_block ON chain_events (block_number, log_index);

-- Derived / projected tables (rebuildable from chain_events).
CREATE TABLE IF NOT EXISTS events (
  event_id       TEXT PRIMARY KEY,
  name           TEXT,
  event_date     TEXT,
  venue          TEXT,
  organizer      TEXT,
  face_value_wei TEXT,
  max_supply     TEXT,
  metadata_uri   TEXT,
  created_block  INTEGER NOT NULL,
  created_tx     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tickets (
  token_id      TEXT PRIMARY KEY,
  event_id      TEXT,
  owner         TEXT,
  token_uri     TEXT,
  status        TEXT NOT NULL DEFAULT 'valid',   -- valid | checked_in
  last_price_wei TEXT,
  minted_block  INTEGER NOT NULL,
  minted_tx     TEXT NOT NULL,
  checked_in_tx TEXT,
  checked_in_block INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tickets_owner ON tickets (owner COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_tickets_event ON tickets (event_id);

CREATE TABLE IF NOT EXISTS listings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  token_id      TEXT NOT NULL,
  event_id      TEXT,
  seller        TEXT,
  price_wei     TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active',  -- active | sold | cancelled | invalidated | superseded
  listed_block  INTEGER NOT NULL,
  listed_tx     TEXT NOT NULL,
  listed_log_index INTEGER NOT NULL,
  closed_tx     TEXT,
  buyer         TEXT,
  UNIQUE (listed_tx, listed_log_index)
);
CREATE INDEX IF NOT EXISTS idx_listings_active ON listings (status, token_id);

CREATE TABLE IF NOT EXISTS checkin_challenges (
  id               TEXT PRIMARY KEY,
  ticket_id        TEXT NOT NULL,
  holder           TEXT NOT NULL,
  nonce            TEXT NOT NULL,
  message          TEXT NOT NULL,
  chain_id         INTEGER NOT NULL,
  contract_address TEXT NOT NULL,
  issued_at        INTEGER NOT NULL,   -- unix ms
  expires_at       INTEGER NOT NULL,   -- unix ms
  status           TEXT NOT NULL DEFAULT 'pending',  -- pending | consumed | invalidated
  consumed_at      INTEGER
);
CREATE INDEX IF NOT EXISTS idx_challenges_ticket ON checkin_challenges (ticket_id, status);
CREATE INDEX IF NOT EXISTS idx_challenges_expiry ON checkin_challenges (expires_at);

CREATE TABLE IF NOT EXISTS metadata_cache (
  uri        TEXT PRIMARY KEY,
  json       TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);
`;

export const DERIVED_TABLES = ['events', 'tickets', 'listings'] as const;

export function openDatabase(file: string): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  initSchema(db);
  return db;
}

export function initSchema(db: DB): void {
  db.exec(SCHEMA);
  const v = db.pragma('user_version', { simple: true }) as number;
  if (v < SCHEMA_VERSION) db.pragma(`user_version = ${SCHEMA_VERSION}`);
}

export function getState(db: DB, key: string): string | undefined {
  return (db.prepare('SELECT value FROM indexer_state WHERE key = ?').get(key) as { value: string } | undefined)?.value;
}
export function setState(db: DB, key: string, value: string): void {
  db.prepare('INSERT INTO indexer_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}
