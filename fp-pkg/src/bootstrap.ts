import type { AppConfig } from './config.js';
import { EthersChainReader } from './chain/EthersChainReader.js';
import { openDatabase } from './db/database.js';
import { Indexer } from './indexer/Indexer.js';

export function buildRuntime(config: AppConfig) {
  const db = openDatabase(config.databasePath);
  const chain = new EthersChainReader(config);
  if (chain.missingEvents.length) {
    console.warn(`[config] events not found in the ABI (ignored by the indexer): ${chain.missingEvents.join(', ')}`);
  }
  const indexer = new Indexer(db, chain, {
    startBlock: config.startBlock, batchSize: config.indexer.batchSize, confirmations: config.indexer.confirmations,
    maxReorgDepth: config.indexer.maxReorgDepth, pollMs: config.indexer.pollMs, argMapJson: config.eventArgMapJson,
  });
  return { db, chain, indexer };
}
