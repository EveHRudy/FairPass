import type { DB } from '../db/database.js';
import { getState, setState } from '../db/database.js';
import type { ChainReader, RawLog } from '../chain/ChainReader.js';
import { ArgMap } from './argMap.js';
import { project, rebuildProjections } from './projector.js';

export interface IndexerOptions {
  startBlock: number;
  batchSize: number;
  confirmations: number;
  maxReorgDepth: number;
  pollMs: number;
  /** retry delays in ms for transient RPC failures (override in tests) */
  retryDelaysMs?: number[];
  argMapJson?: string;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

const LAST_BLOCK = 'last_processed_block';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const RANGE_ERR = /range|more than \d+ results|too large|too many|exceed|limit/i;
/** Message of an error plus the message of its underlying cause (ChainUnavailableError wraps RPC errors). */
const errText = (e: unknown) => `${(e as Error)?.message ?? e} ${(e as any)?.cause?.message ?? ''} ${(e as any)?.cause?.shortMessage ?? ''}`;

export class Indexer {
  private map: ArgMap;
  private timer?: NodeJS.Timeout;
  private running = false;
  private stopped = false;
  private log: Pick<Console, 'info' | 'warn' | 'error'>;
  private retry: number[];
  lastError?: string;

  constructor(private db: DB, private chain: ChainReader, private opts: IndexerOptions) {
    this.map = new ArgMap(opts.argMapJson);
    this.log = opts.logger ?? console;
    this.retry = opts.retryDelaysMs ?? [500, 1500, 4000, 10000];
  }

  /** Last block whose logs are fully stored. startBlock-1 when nothing has been indexed. */
  lastProcessedBlock(): number {
    const v = getState(this.db, LAST_BLOCK);
    return v === undefined ? this.opts.startBlock - 1 : Number(v);
  }

  /** One full catch-up pass. Safe to call concurrently (second call is skipped). */
  async runOnce(): Promise<{ processedTo: number; newEvents: number }> {
    if (this.running) return { processedTo: this.lastProcessedBlock(), newEvents: 0 };
    this.running = true;
    try {
      await this.handleReorg();
      const head = await this.withRetry(() => this.chain.blockNumber());
      const safeHead = head - this.opts.confirmations;
      let from = this.lastProcessedBlock() + 1;
      let batch = this.opts.batchSize;
      let newEvents = 0;
      while (from <= safeHead && !this.stopped) {
        const to = Math.min(from + batch - 1, safeHead);
        let logs: RawLog[];
        try {
          logs = await this.withRetry(() => this.chain.getLogs(from, to));
        } catch (err) {
          // Providers reject over-wide ranges ("query returned more than 10000 results", "range too large").
          if (batch > 50 && RANGE_ERR.test(errText(err))) {
            batch = Math.max(50, Math.floor(batch / 2));
            this.log.warn(`[indexer] range rejected, shrinking batch to ${batch}`);
            continue;
          }
          throw err;
        }
        const endInfo = await this.withRetry(() => this.chain.blockInfo(to));
        const times = new Map<number, number>();
        for (const l of logs) {
          if (!times.has(l.blockNumber)) times.set(l.blockNumber, (await this.withRetry(() => this.chain.blockInfo(l.blockNumber)))?.timestamp ?? 0);
        }
        newEvents += this.commitBatch(logs, times, to, endInfo?.hash);
        from = to + 1;
      }
      this.lastError = undefined;
      return { processedTo: this.lastProcessedBlock(), newEvents };
    } catch (err) {
      this.lastError = (err as Error).message;
      throw err;
    } finally {
      this.running = false;
    }
  }

  /** Atomically stores a batch + advances the checkpoint. Re-processing the same logs is a no-op. */
  private commitBatch(logs: RawLog[], times: Map<number, number>, to: number, endHash?: string): number {
    let inserted = 0;
    const tx = this.db.transaction(() => {
      const ins = this.db.prepare(
        `INSERT OR IGNORE INTO chain_events (event_name, block_number, block_hash, block_time, tx_hash, log_index, args_json)
         VALUES (?,?,?,?,?,?,?)`,
      );
      const ordered = [...logs].sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
      for (const l of ordered) {
        const r = ins.run(l.eventName, l.blockNumber, l.blockHash, times.get(l.blockNumber) ?? null, l.txHash, l.logIndex, JSON.stringify(l.args));
        if (r.changes === 1) {
          inserted++;
          project(this.db, {
            id: Number(r.lastInsertRowid), event_name: l.eventName, block_number: l.blockNumber,
            block_time: times.get(l.blockNumber) ?? null, tx_hash: l.txHash, log_index: l.logIndex, args: l.args,
          }, this.map);
        }
      }
      if (endHash) this.db.prepare('INSERT OR REPLACE INTO block_hashes (block_number, block_hash) VALUES (?,?)').run(to, endHash);
      setState(this.db, LAST_BLOCK, String(to));
    });
    tx();
    return inserted;
  }

  /** Compares stored checkpoint hashes with the chain; on mismatch rolls back to the last common block. */
  private async handleReorg(): Promise<void> {
    const rows = this.db.prepare('SELECT block_number, block_hash FROM block_hashes ORDER BY block_number DESC LIMIT 200').all() as
      Array<{ block_number: number; block_hash: string }>;
    if (rows.length === 0) return;
    const newest = rows[0];
    const cur = await this.withRetry(() => this.chain.blockInfo(newest.block_number));
    if (cur && cur.hash === newest.block_hash) return;

    this.log.warn(`[indexer] reorg detected at block ${newest.block_number}; searching common ancestor`);
    const limit = newest.block_number - this.opts.maxReorgDepth;
    let ancestor = this.opts.startBlock - 1;
    for (const r of rows) {
      if (r.block_number < limit) break;
      const info = await this.withRetry(() => this.chain.blockInfo(r.block_number));
      if (info && info.hash === r.block_hash) { ancestor = r.block_number; break; }
    }
    this.rollbackTo(ancestor);
  }

  rollbackTo(block: number): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM chain_events WHERE block_number > ?').run(block);
      this.db.prepare('DELETE FROM block_hashes WHERE block_number > ?').run(block);
      setState(this.db, LAST_BLOCK, String(block));
      rebuildProjections(this.db, this.map);
    })();
    this.log.warn(`[indexer] rolled back to block ${block}; re-indexing`);
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    for (let i = 0; ; i++) {
      try { return await fn(); } catch (err) {
        const msg = errText(err);
        // Over-wide-range errors are handled by the caller (batch shrinking) – fail fast for those.
        if (RANGE_ERR.test(msg) || i >= this.retry.length) throw err;
        this.log.warn(`[indexer] transient error (${msg.slice(0, 120)}), retry ${i + 1}/${this.retry.length}`);
        await sleep(this.retry[i]);
      }
    }
  }

  /** Starts the polling loop; failures are logged and retried on the next tick, never crash the process. */
  start(): void {
    this.stopped = false;
    const tick = async () => {
      if (this.stopped) return;
      try {
        const r = await this.runOnce();
        if (r.newEvents) this.log.info(`[indexer] +${r.newEvents} events, now at block ${r.processedTo}`);
      } catch (err) {
        this.log.error(`[indexer] pass failed: ${(err as Error).message}`);
      }
      if (!this.stopped) this.timer = setTimeout(tick, this.opts.pollMs);
    };
    void tick();
  }
  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }
}
