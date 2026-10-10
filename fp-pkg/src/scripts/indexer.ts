/** Standalone indexer:  npm run indexer            (continuous)
 *                       npm run indexer -- --once  (catch up and exit)
 *                       npm run indexer -- --reset (drop indexed data, re-scan from START_BLOCK) */
import { buildRuntime } from '../bootstrap.js';
import { loadConfig } from '../config.js';
import { DERIVED_TABLES } from '../db/database.js';

const config = loadConfig();
const { db, indexer } = buildRuntime(config);
const args = process.argv.slice(2);

if (args.includes('--reset')) {
  db.transaction(() => {
    for (const t of [...DERIVED_TABLES, 'chain_events', 'block_hashes']) db.exec(`DELETE FROM ${t}`);
    db.exec(`DELETE FROM indexer_state`);
  })();
  console.log('[indexer] index cleared; challenges and metadata cache were kept.');
}

if (args.includes('--once')) {
  const r = await indexer.runOnce();
  console.log(`[indexer] caught up to block ${r.processedTo} (+${r.newEvents} events)`);
  db.close();
} else {
  console.log(`[indexer] starting from block ${indexer.lastProcessedBlock() + 1}`);
  indexer.start();
  const stop = () => { indexer.stop(); db.close(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
