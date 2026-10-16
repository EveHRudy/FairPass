import { createApp } from './app.js';
import { buildRuntime } from './bootstrap.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const { db, chain, indexer } = await buildRuntime(config);

const actual = await chain.chainId().catch((e) => { console.error('[startup] cannot reach RPC:', (e as Error).message); return null; });
if (actual !== null && actual !== config.chainId) {
  console.error(`[startup] CHAIN_ID=${config.chainId} but the RPC reports chain ${actual}. Fix .env.`);
  process.exit(1);
}

const app = createApp({ config, db, chain, indexerStatus: () => ({ lastError: indexer.lastError }) });
const server = app.listen(config.port, () => console.log(`[api] FairPass backend listening on :${config.port}`));
if (config.indexer.enabled) indexer.start();

const shutdown = () => { indexer.stop(); server.close(() => { db.close(); process.exit(0); }); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
