import { createApp } from './app.js';
import { buildRuntime } from './bootstrap.js';
import { loadConfig } from './config.js';

const config = loadConfig();

if (config.chainId === 11155111 && !config.pinataJwt) {
  console.warn('[config] Notice: PINATA_JWT is not set in backend/.env. IPFS uploads for Sepolia ticket purchases will require a Pinata JWT.');
}

const { db, chain, indexer } = await buildRuntime(config);

const actual = await chain.chainId().catch((e) => { console.error('[startup] cannot reach RPC:', (e as Error).message); return null; });
if (actual !== null && actual !== config.chainId) {
  console.error(`[startup] CHAIN_ID=${config.chainId} but the RPC reports chain ${actual}. Fix .env.`);
  process.exit(1);
}

const app = createApp({ config, db, chain, indexerStatus: () => ({ lastError: indexer.lastError }) });
const server = app.listen(config.port, () => console.log(`[api] FairPass backend listening on :${config.port}`));

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n[api] Error: Port ${config.port} is already in use.`);
    console.error(`[api] Another backend process is already running on port ${config.port}.`);
    console.error(`[api] Please stop the existing process or set PORT=<another_port> in backend/.env.\n`);
  } else {
    console.error('[api] Server error:', err.message || err);
  }
  process.exit(1);
});

if (config.indexer.enabled) indexer.start();

const shutdown = () => { indexer.stop(); server.close(() => { db.close(); process.exit(0); }); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

