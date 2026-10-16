/**
 * Self-contained end-to-end demo (no RPC, no Pinata needed):  npm run demo
 * Runs the real indexer, REST API and check-in service against an in-memory fake chain and prints every step.
 */
import { Wallet } from 'ethers';
import type { AddressInfo } from 'node:net';
import { createApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase } from '../db/database.js';
import { Indexer } from '../indexer/Indexer.js';
import { FakeChain } from '../testing/fakeChain.js';
import { buildScannerConfirmMessage } from '../shared/checkinMessage.js';

const config = loadConfig({ CHAIN_ID: '11155111', START_BLOCK: '1' } as NodeJS.ProcessEnv);
const db = openDatabase(':memory:');
const chain = new FakeChain();
const quiet = { info() {}, warn() {}, error() {} };
const indexer = new Indexer(db, chain, { startBlock: 1, batchSize: 1000, confirmations: 0, maxReorgDepth: 64, pollMs: 100, logger: quiet });

const organizer = Wallet.createRandom(), alice = Wallet.createRandom(), bob = Wallet.createRandom();
const step = (t: string) => console.log(`\n=== ${t} ===`);

chain.createEvent(1, organizer.address, 'Neon Nights', 'Hall A', (10n ** 18n).toString(), 100);
chain.mint(1, 1, alice.address);
chain.mint(2, 1, alice.address);
chain.list(2, alice.address, '1100000000000000000');
await indexer.runOnce();

const server = createApp({ config, db, chain, silent: true }).listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const call = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: (await res.json()) as any };
};

step('GET /events');
const ev = await call('GET', '/events');
console.log(ev.status, JSON.stringify(ev.json.events[0], null, 2));

step('GET /listings (cap = face value x 110%, royalty read from the contract)');
const ls = await call('GET', '/listings');
console.log(ls.status, JSON.stringify(ls.json.listings[0], null, 2));

step(`GET /tickets/${alice.address}`);
const tk = await call('GET', `/tickets/${alice.address}`);
console.log(tk.status, tk.json.tickets.map((t: any) => `ticket ${t.ticketId}: ${t.status}`).join(', '));

step('POST /checkin/challenge  (attendee app)');
const ch = await call('POST', '/checkin/challenge', { ticketId: '1', holder: alice.address });
console.log(ch.status, ch.json.message);

step('Attendee wallet signs the message -> QR payload');
const signature = await alice.signMessage(ch.json.message);
const qr = { v: 1, challengeId: ch.json.challengeId, ticketId: '1', signature };
console.log(JSON.stringify(qr));

step('POST /checkin/verify  (venue scanner)');
const ok = await call('POST', '/checkin/verify', qr);
console.log(ok.status, ok.json);

step('Replay the same QR');
const replay = await call('POST', '/checkin/verify', qr);
console.log(replay.status, replay.json);

step('Authorized scanner signs confirmation; backend submits checkIn(1) on-chain');
chain.authorizeVenue('1', chain.venueWalletAddress); // organizer-authorized backend transaction signer
const signedAt = Date.now();
const operatorMessage = buildScannerConfirmMessage({
  challengeId: ch.json.challengeId, ticketId: '1', eventId: '1', chainId: config.chainId,
  contract: chain.contractAddress, operatorAddress: organizer.address, signedAt,
});
const operatorSignature = await organizer.signMessage(operatorMessage);
const confirmed = await call('POST', '/checkin/confirm', {
  challengeId: ch.json.challengeId, ticketId: '1', operatorAddress: organizer.address, operatorSignature, signedAt,
});
console.log(confirmed.status, confirmed.json);
await indexer.runOnce();
console.log('GET /checkin/status/1 ->', (await call('GET', '/checkin/status/1')).json);
console.log('Fresh challenge for the used ticket ->', (await call('POST', '/checkin/challenge', { ticketId: '1', holder: alice.address })).json.error);

step('Stolen QR: Bob signs a challenge for Alice\'s ticket 2');
const ch2 = await call('POST', '/checkin/challenge', { ticketId: '2', holder: alice.address });
const bad = await call('POST', '/checkin/verify', { v: 1, challengeId: ch2.json.challengeId, ticketId: '2', signature: await bob.signMessage(ch2.json.message) });
console.log(bad.status, bad.json);

server.close();
db.close();
console.log('\nDemo finished OK.');
