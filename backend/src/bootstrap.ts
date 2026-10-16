import type { AppConfig } from './config.js';
import { EthersChainReader } from './chain/EthersChainReader.js';
import { openDatabase } from './db/database.js';
import { Indexer } from './indexer/Indexer.js';

export async function buildRuntime(config: AppConfig) {
  const db = openDatabase(config.databasePath);
  const chain = new EthersChainReader(config);
  if (chain.missingEvents.length) {
    console.warn(`[config] events not found in ABI (ignored by the indexer): ${chain.missingEvents.join(', ')}`);
  }
  let startBlock = config.startBlock;
  if (config.chainId === 11155111 && startBlock === 0 && config.deploymentTxHash) {
    const deployedAt = await chain.deploymentBlock();
    if (deployedAt !== null) startBlock = deployedAt;
    else console.warn('[indexer] deployment transaction receipt was not found; scanning from block 0. Set START_BLOCK to override.');
  }
  const indexer = new Indexer(db, chain, {
    startBlock, batchSize: config.indexer.batchSize, confirmations: config.indexer.confirmations,
    maxReorgDepth: config.indexer.maxReorgDepth, pollMs: config.indexer.pollMs, argMapJson: config.eventArgMapJson,
  });
  return { db, chain, indexer };
}
