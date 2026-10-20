/**
 * Runs the real EthersChainReader + Indexer against a local Hardhat node (real EVM, real logs).
 * Uses test/fixtures/MockTicketing.sol, compiled in-process with solc-js, so no compiler download is needed.
 * Run with:  npm run test:chain
 */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ContractFactory, JsonRpcProvider, Wallet, Interface } from 'ethers';
import solc from 'solc';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EthersChainReader } from '../src/chain/EthersChainReader.js';
import { openDatabase } from '../src/db/database.js';
import { Indexer } from '../src/indexer/Indexer.js';
import { ChainUnavailableError } from '../src/errors.js';
import { testConfig, silent } from './helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 18545;
const RPC = `http://127.0.0.1:${PORT}`;
let node: ChildProcess;

async function waitForNode() {
  for (let i = 0; i < 60; i++) {
    try { await new JsonRpcProvider(RPC).getBlockNumber(); return; } catch { await new Promise((r) => setTimeout(r, 500)); }
  }
  throw new Error('hardhat node did not start');
}

describe.runIf(process.env.CHAIN_TESTS === '1')('EthersChainReader against a real EVM', () => {
  beforeAll(async () => {
    const command = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'npx';
    const args = process.platform === 'win32'
      ? ['/d', '/s', '/c', `npx hardhat node --port ${PORT}`]
      : ['hardhat', 'node', '--port', String(PORT)];
    const projectRoot = path.resolve(__dirname, '../..');
    node = spawn(command, args, { cwd: projectRoot, env: { ...process.env, HARDHAT_DISABLE_TELEMETRY_PROMPT: 'true' }, stdio: 'ignore' });
    await waitForNode();
  }, 60_000);
  afterAll(() => { node?.kill('SIGKILL'); });

  it('decodes logs, reads ownerOf / check-in / cap, and indexes end to end', async () => {
    const src = fs.readFileSync(path.join(__dirname, 'fixtures/MockTicketing.sol'), 'utf8');
    const out = JSON.parse(solc.compile(JSON.stringify({
      language: 'Solidity', sources: { 'M.sol': { content: src } },
      settings: { outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } },
    })));
    expect(out.errors?.filter((e: any) => e.severity === 'error') ?? []).toEqual([]);
    const c = out.contracts['M.sol'].MockTicketing;
    const abiPath = path.join(__dirname, 'fixtures/MockTicketing.abi.json');
    fs.writeFileSync(abiPath, JSON.stringify(c.abi));

    const provider = new JsonRpcProvider(RPC, undefined, { cacheTimeout: -1 }); // no caching: automine + nonce lookups
    const deployer = new Wallet('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', provider); // hardhat account #0
    const alice = Wallet.createRandom(), bob = Wallet.createRandom();
    const contract: any = await new ContractFactory(new Interface(c.abi), c.evm.bytecode.object, deployer).deploy();
    await contract.waitForDeployment();
    const address = await contract.getAddress();
    const startBlock = (await provider.getBlockNumber());

    await (await contract.createEvent(1, 'Neon Nights', 'Hall A', 1800000000, 10n ** 18n, 100)).wait();
    await (await contract.mint(1, 1, alice.address)).wait();
    await (await contract.list(1, 1_050_000_000_000_000_000n)).wait();
    await (await contract.sell(1, bob.address, 1_050_000_000_000_000_000n)).wait();
    await (await contract.checkIn(1)).wait();

    const cfg = testConfig({ RPC_URL: RPC, CHAIN_ID: '31337', CONTRACT_ADDRESS: address, CONTRACT_ABI_PATH: abiPath });
    const reader = new EthersChainReader(cfg);
    expect(reader.missingEvents).toEqual(['ListingCancelled', 'Withdrawn', 'VenueAdded', 'VenueRemoved']);
    expect(await reader.ownerOf('1')).toBe(bob.address);
    expect(await reader.ownerOf('999')).toBeNull();                      // revert => "does not exist", not an outage
    expect(await reader.isCheckedIn('1')).toBe(true);
    expect(await reader.resalePolicy()).toMatchObject({ capPercent: 10, capSource: 'contract', royaltyPercent: 5, royaltySource: 'contract' });

    const db = openDatabase(':memory:');
    const idx = new Indexer(db, reader, { startBlock, batchSize: 1000, confirmations: 0, maxReorgDepth: 64, pollMs: 100, logger: silent });
    await idx.runOnce();
    expect(db.prepare('SELECT name, venue, face_value_wei, max_supply FROM events').get()).toEqual({ name: 'Neon Nights', venue: 'Hall A', face_value_wei: '1000000000000000000', max_supply: '100' });
    expect(db.prepare('SELECT owner, status FROM tickets').get()).toEqual({ owner: bob.address, status: 'checked_in' });
    expect(db.prepare('SELECT status, seller, buyer FROM listings').get()).toMatchObject({ status: 'sold', buyer: bob.address });
    expect((db.prepare('SELECT COUNT(*) c FROM chain_events').get() as any).c).toBe(5);
    await idx.runOnce();                                                  // second pass: no duplicates
    expect((db.prepare('SELECT COUNT(*) c FROM chain_events').get() as any).c).toBe(5);
    fs.rmSync(abiPath);
  }, 60_000);

  it('reports an unreachable node as ChainUnavailableError', async () => {
    const cfg = testConfig({ RPC_URL: 'http://127.0.0.1:1', CHAIN_ID: '31337', CONTRACT_ADDRESS: '0x00000000000000000000000000000000000fa1c3', CONTRACT_ABI_PATH: 'abi/FairPass.abi.example.json' });
    await expect(new EthersChainReader(cfg).blockNumber()).rejects.toBeInstanceOf(ChainUnavailableError);
  }, 30_000);
});
