import { Wallet } from 'ethers';
import { loadConfig, type AppConfig } from '../src/config.js';
import { openDatabase } from '../src/db/database.js';
import { Indexer } from '../src/indexer/Indexer.js';
import { FakeChain } from '../src/testing/fakeChain.js';

export function testConfig(over: Record<string, string> = {}): AppConfig {
  return loadConfig({ CHAIN_ID: '11155111', CHALLENGE_TTL_SECONDS: '30', START_BLOCK: '1', ...over } as NodeJS.ProcessEnv);
}
export const silent = { info() {}, warn() {}, error() {} };

export function makeIndexer(db = openDatabase(':memory:'), chain = new FakeChain(), opts: Partial<ConstructorParameters<typeof Indexer>[2]> = {}) {
  const indexer = new Indexer(db, chain, {
    startBlock: 1, batchSize: 1000, confirmations: 0, maxReorgDepth: 64, pollMs: 50, retryDelaysMs: [1, 1, 1, 1], logger: silent, ...opts,
  });
  return { db, chain, indexer };
}

/** Standard fixture: organizer, two buyers, event 1 (face 1 ETH, 100 supply), tickets 1..3. */
export function seedChain(chain: FakeChain) {
  const organizer = Wallet.createRandom(), alice = Wallet.createRandom(), bob = Wallet.createRandom();
  chain.createEvent(1, organizer.address, 'Neon Nights', 'Hall A', '1000000000000000000', 100);
  chain.mint(1, 1, alice.address);
  chain.mint(2, 1, alice.address);
  chain.mint(3, 1, bob.address);
  return { organizer, alice, bob };
}
