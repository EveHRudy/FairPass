import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase, setState } from '../src/db/database.js';
import { Indexer } from '../src/indexer/Indexer.js';
import { FakeChain } from '../src/testing/fakeChain.js';
import { makeIndexer, seedChain, silent } from './helpers.js';

const count = (db: any, table: string) => (db.prepare(`SELECT COUNT(*) c FROM ${table}`).get() as { c: number }).c;

describe('indexer', () => {
  it('indexes historical events into derived tables and tracks Sold / CheckedIn', async () => {
    const { db, chain, indexer } = makeIndexer();
    const { alice, bob } = seedChain(chain);
    chain.list(1, alice.address, '1050000000000000000');
    chain.sell(1, alice.address, bob.address, '1050000000000000000');
    chain.list(2, alice.address, '1100000000000000000');
    chain.checkIn(2);
    await indexer.runOnce();
    expect(count(db, 'events')).toBe(1);
    expect(count(db, 'tickets')).toBe(3);
    expect((db.prepare(`SELECT owner FROM tickets WHERE token_id='1'`).get() as any).owner).toBe(bob.address);
    expect(db.prepare(`SELECT status FROM listings WHERE token_id='1'`).get()).toEqual({ status: 'sold' });
    expect(db.prepare(`SELECT status FROM listings WHERE token_id='2'`).get()).toEqual({ status: 'invalidated' });
    expect(db.prepare(`SELECT status FROM tickets WHERE token_id='2'`).get()).toEqual({ status: 'checked_in' });
  });

  it('resumes after a restart without losing or duplicating data', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fp-')), 'idx.sqlite');
    const chain = new FakeChain();
    const { alice } = seedChain(chain);
    let db = openDatabase(file);
    let { indexer } = makeIndexer(db, chain);
    await indexer.runOnce();
    const checkpoint = indexer.lastProcessedBlock();
    db.close();

    chain.mint(4, 1, alice.address);                 // happens while the backend is down
    db = openDatabase(file);
    ({ indexer } = makeIndexer(db, chain));
    expect(indexer.lastProcessedBlock()).toBe(checkpoint);
    const callsBefore = chain.getLogsCalls;
    await indexer.runOnce();
    expect(chain.getLogsCalls - callsBefore).toBe(1); // only the new range is scanned
    expect(count(db, 'tickets')).toBe(4);
    expect(count(db, 'chain_events')).toBe(5);
  });

  it('is idempotent when the same logs are processed twice', async () => {
    const { db, chain, indexer } = makeIndexer();
    seedChain(chain);
    await indexer.runOnce();
    setState(db, 'last_processed_block', '0');       // force a full re-scan
    await indexer.runOnce();
    expect(count(db, 'chain_events')).toBe(4);
    expect(count(db, 'tickets')).toBe(3);
  });

  it('rolls back and rebuilds after a chain reorganisation', async () => {
    const { db, chain, indexer } = makeIndexer();
    const { alice } = seedChain(chain);
    await indexer.runOnce();                          // checkpoint at block 5
    const safe = chain.head;
    chain.list(1, alice.address, '1050000000000000000');
    await indexer.runOnce();
    expect(count(db, 'listings')).toBe(1);
    chain.reorg(safe, [[]]);                          // listing block is replaced by an empty block
    await indexer.runOnce();
    expect(count(db, 'listings')).toBe(0);
    expect(count(db, 'tickets')).toBe(3);
  });

  it('survives transient RPC failures with retries', async () => {
    const { db, chain, indexer } = makeIndexer();
    seedChain(chain);
    chain.failures = 3;
    await indexer.runOnce();
    expect(count(db, 'tickets')).toBe(3);
  });

  it('shrinks the batch size when the provider rejects wide ranges', async () => {
    const { db, chain, indexer } = makeIndexer(undefined, undefined, { batchSize: 5000 });
    seedChain(chain);
    chain.mineEmpty(400);
    chain.maxRange = 100;
    await indexer.runOnce();
    expect(count(db, 'tickets')).toBe(3);
    expect(indexer.lastProcessedBlock()).toBe(chain.head);
  });

  it('respects the confirmation depth', async () => {
    const { chain, indexer } = makeIndexer(undefined, undefined, { confirmations: 3 });
    seedChain(chain);
    await indexer.runOnce();
    expect(indexer.lastProcessedBlock()).toBe(chain.head - 3);
  });

  it('honours START_BLOCK', async () => {
    const chain = new FakeChain();
    seedChain(chain);
    const { db, indexer } = makeIndexer(undefined, chain, { startBlock: 4 }); // blocks: 1 genesis, 2 event, 3-5 mints
    await indexer.runOnce();
    expect(count(db, 'events')).toBe(0);   // EventCreated (block 2) is before START_BLOCK
    expect(count(db, 'tickets')).toBe(2);  // only mints in blocks 4 and 5
  });
});
