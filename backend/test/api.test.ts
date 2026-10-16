import request from 'supertest';
import { Wallet } from 'ethers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { MetadataService } from '../src/services/metadataService.js';
import { buildScannerConfirmMessage } from '../src/shared/checkinMessage.js';
import { makeIndexer, seedChain, testConfig } from './helpers.js';

const CID = 'bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy';
const openedDbs: Array<ReturnType<typeof makeIndexer>['db']> = [];
afterEach(() => { while (openedDbs.length) { const db = openedDbs.pop()!; if (db.open) db.close(); } });

async function setup(over: Record<string, string> = {}, fetchFn?: typeof fetch) {
  const { db, chain, indexer } = makeIndexer();
  openedDbs.push(db);
  const users = seedChain(chain);
  const config = testConfig(over);
  const metadata = new MetadataService(config, db, fetchFn ?? (vi.fn(async () => new Response('{}', { status: 404 })) as any));
  const app = createApp({ config, db, chain, metadata, silent: true });
  return { db, chain, indexer, app, users, config };
}

describe('GET /events, /events/:id', () => {
  it('lists indexed events with remaining supply and 404s unknown ids', async () => {
    const { app, indexer } = await setup();
    await indexer.runOnce();
    const list = await request(app).get('/events').expect(200);
    expect(list.body.total).toBe(1);
    expect(list.body.events[0]).toMatchObject({ eventId: '1', name: 'Neon Nights', venue: 'Hall A', totalSupply: '100', ticketsSold: 3, remainingSupply: '97', faceValueEth: '1.0' });
    const one = await request(app).get('/events/1').expect(200);
    expect(one.body.tickets).toHaveLength(3);
    await request(app).get('/events/42').expect(404);
    await request(app).get('/events/abc').expect(400);
  });
});

describe('GET /listings', () => {
  it('computes cap and royalty from the contract policy and hides stale / invalid listings', async () => {
    const { app, indexer, chain, users } = await setup();
    chain.list(1, users.alice.address, '1100000000000000000');   // exactly at cap (1 ETH * 110 / 100)
    chain.list(2, users.alice.address, '1500000000000000000');   // above cap (the contract would reject it; flagged anyway)
    chain.list(3, users.bob.address, '1000000000000000000');
    await indexer.runOnce();
    let res = await request(app).get('/listings').expect(200);
    expect(res.body.total).toBe(3);
    const l1 = res.body.listings.find((l: any) => l.ticketId === '1');
    expect(l1).toMatchObject({ maxResalePriceWei: '1100000000000000000', withinCap: true, capPercent: 10, capSource: 'contract', royaltyWei: '55000000000000000', seller: users.alice.address });
    expect(res.body.listings.find((l: any) => l.ticketId === '2').withinCap).toBe(false);

    // stale index: ticket 3 was transferred on-chain, ticket 1 got checked in - indexer has not caught up yet
    chain.owners.set('3', users.alice.address);
    chain.checked.add('1');
    res = await request(app).get('/listings').expect(200);
    expect(res.body.listings.map((l: any) => l.ticketId)).toEqual(['2']);
  });
  it('drops sold listings after indexing', async () => {
    const { app, indexer, chain, users } = await setup();
    chain.list(1, users.alice.address, '1050000000000000000');
    chain.sell(1, users.alice.address, users.bob.address, '1050000000000000000');
    await indexer.runOnce();
    expect((await request(app).get('/listings').expect(200)).body.total).toBe(0);
  });
  it('uses the per-event cap and royalty even when no global policy getter exists', async () => {
    const { app, indexer, chain, users } = await setup();
    chain.policy = { capPercent: null, capSource: 'unavailable', royaltyPercent: null, royaltySource: 'unavailable' };
    chain.list(1, users.alice.address, '1050000000000000000');
    await indexer.runOnce();
    const l = (await request(app).get('/api/listings')).body.listings[0];
    expect(l).toMatchObject({ maxResalePriceWei: '1100000000000000000', withinCap: true, royaltyWei: '52500000000000000', capSource: 'contract', royaltySource: 'contract' });
  });
});

describe('GET /tickets/:address', () => {
  it('returns verified tickets with valid/listed/used status', async () => {
    const { app, indexer, chain, users } = await setup();
    chain.list(2, users.alice.address, '1050000000000000000');
    await indexer.runOnce();
    let res = await request(app).get(`/tickets/${users.alice.address}`).expect(200);
    expect(res.body.tickets.map((t: any) => [t.ticketId, t.status])).toEqual([['1', 'valid'], ['2', 'listed']]);
    chain.checkIn(1);
    chain.owners.set('2', users.bob.address);                     // stale index: no longer Alice's on-chain
    res = await request(app).get(`/tickets/${users.alice.address.toLowerCase()}`).expect(200);
    expect(res.body.tickets.map((t: any) => [t.ticketId, t.status, t.valid])).toEqual([['1', 'used', false]]);
  });
  it('rejects invalid addresses', async () => {
    const { app } = await setup();
    await request(app).get('/tickets/not-an-address').expect(400);
  });
});

describe('check-in HTTP flow', () => {
  it('challenge -> verify -> replay', async () => {
    const { app, users } = await setup();
    const ch = await request(app).post('/checkin/challenge').send({ ticketId: '1', holder: users.alice.address }).expect(201);
    const signature = await users.alice.signMessage(ch.body.message);
    const body = { v: 1, challengeId: ch.body.challengeId, ticketId: '1', signature };
    const ok = await request(app).post('/checkin/verify').send(body).expect(200);
    expect(ok.body).toMatchObject({ valid: true, code: 'VALID', next: 'SUBMIT_CHECKIN_TRANSACTION' });
    const replay = await request(app).post('/checkin/verify').send(body).expect(409);
    expect(replay.body).toMatchObject({ valid: false, code: 'ALREADY_CONSUMED' });
  });
  it('validates payloads and maps chain outages to 503', async () => {
    const { app, chain, users } = await setup();
    await request(app).post('/checkin/verify').send({ v: 2 }).expect(400);
    await request(app).post('/checkin/verify').send({ v: 1, challengeId: 'x', ticketId: '1', signature: '0x12' }).expect(400);
    await request(app).post('/checkin/challenge').send({ ticketId: 'abc', holder: users.alice.address }).expect(400);
    await request(app).post('/checkin/challenge').send({ ticketId: '1', holder: users.bob.address }).expect(403);
    chain.failures = 1;
    await request(app).post('/checkin/challenge').send({ ticketId: '1', holder: users.alice.address }).expect(503);
  });
  it('supports canonical /api-prefixed routes used by the frontend', async () => {
    const { app, indexer, users, chain } = await setup();
    await indexer.runOnce();
    await request(app).get('/api/events').expect(200);
    const ch = await request(app).post('/api/checkin/challenge').send({ ticketId: '1', holder: users.alice.address }).expect(201);
    const signature = await users.alice.signMessage(ch.body.message);
    const p = { v: 1, challengeId: ch.body.challengeId, ticketId: '1', eventId: '1', signature };
    await request(app).post('/api/checkin/verify').send(p).expect(200);
    chain.authorizeVenue('1', users.alice.address);
    chain.authorizeVenue('1', chain.venueWalletAddress);
    const signedAt = Date.now();
    const operatorMessage = buildScannerConfirmMessage({ challengeId: ch.body.challengeId, ticketId: '1', eventId: '1', chainId: 11155111, contract: chain.contractAddress, operatorAddress: users.alice.address, signedAt });
    const operatorSignature = await users.alice.signMessage(operatorMessage);
    const confirmed = await request(app).post('/api/checkin/confirm').send({ challengeId: ch.body.challengeId, ticketId: '1', operatorAddress: users.alice.address, operatorSignature, signedAt }).expect(200);
    expect(confirmed.body).toMatchObject({ success: true, status: 'confirmed' });
  });
  it('exposes authoritative status', async () => {
    const { app, chain } = await setup();
    expect((await request(app).get('/checkin/status/1').expect(200)).body.checkedIn).toBe(false);
    chain.checkIn(1);
    expect((await request(app).get('/checkin/status/1').expect(200)).body.checkedIn).toBe(true);
    await request(app).get('/checkin/status/77').expect(404);
  });
});

describe('POST /metadata', () => {
  const body = { eventName: 'Neon Nights', date: '2027-01-15T19:00:00Z', venue: 'Hall A', tier: 'VIP', seat: 'A-12', image: `ipfs://${CID}` };

  it('pins metadata and returns the CID and URIs', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ IpfsHash: CID }), { status: 200 }));
    const { app } = await setup({ PINATA_JWT: 'jwt-secret' }, fetchFn as any);
    const res = await request(app).post('/metadata').send(body).expect(201);
    expect(res.body).toMatchObject({ cid: CID, uri: `ipfs://${CID}`, gatewayUrl: `https://gateway.pinata.cloud/ipfs/${CID}` });
    expect(res.body.metadata).toMatchObject({ name: 'Neon Nights — VIP · A-12', image: `ipfs://${CID}` });
    expect(res.body.metadata.attributes).toContainEqual({ trait_type: 'Seat', value: 'A-12' });
    const [url, init] = fetchFn.mock.calls[0] as any;
    expect(url).toBe('https://api.pinata.cloud/pinning/pinJSONToIPFS');
    expect(init.headers.Authorization).toBe('Bearer jwt-secret');
    expect(JSON.stringify(res.body)).not.toContain('jwt-secret');
  });
  it('supports gateway URI format', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ IpfsHash: CID }), { status: 200 }));
    const { app } = await setup({ PINATA_JWT: 'x', TOKEN_URI_FORMAT: 'gateway' }, fetchFn as any);
    expect((await request(app).post('/metadata').send(body)).body.uri).toBe(`https://gateway.pinata.cloud/ipfs/${CID}`);
  });
  it('fails honestly: missing credentials, bad credentials, outages, bad responses', async () => {
    let { app } = await setup();
    await request(app).post('/metadata').send(body).expect(503);
    ({ app } = await setup({ PINATA_JWT: 'x' }, vi.fn(async () => new Response('no', { status: 401 })) as any));
    await request(app).post('/metadata').send(body).expect(502);
    ({ app } = await setup({ PINATA_JWT: 'x' }, vi.fn(async () => { throw new Error('ECONNRESET'); }) as any));
    await request(app).post('/metadata').send(body).expect(504);
    ({ app } = await setup({ PINATA_JWT: 'x' }, vi.fn(async () => new Response(JSON.stringify({ nope: 1 }), { status: 200 })) as any));
    const r = await request(app).post('/metadata').send(body).expect(502);
    expect(r.body.cid).toBeUndefined();
  });
  it('supports explicitly local metadata only on a non-Sepolia chain', async () => {
    const { app } = await setup({ CHAIN_ID: '31337', METADATA_LOCAL_MODE: 'true', LOCAL_METADATA_BASE_URL: 'http://localhost:4000' });
    const uploaded = await request(app).post('/api/metadata').send({ ...body, eventId: '1' }).expect(201);
    expect(uploaded.body).toMatchObject({ local: true, ipfsUri: null });
    expect(uploaded.body.uri).toContain(`/local-metadata/${uploaded.body.cid}`);
    expect(uploaded.body.warning).toContain('LOCAL DEMO ONLY');
    const fetched = await request(app).get(`/api/local-metadata/${uploaded.body.cid}`).expect(200);
    expect(fetched.body).toMatchObject({ name: 'Neon Nights — VIP · A-12' });
  });
  it('never allows local HTTP metadata for Sepolia', async () => {
    const { app } = await setup({ CHAIN_ID: '11155111', METADATA_LOCAL_MODE: 'true' });
    await request(app).post('/api/metadata').send(body).expect(503);
  });
  it('rejects invalid input', async () => {
    const { app } = await setup({ PINATA_JWT: 'x' });
    await request(app).post('/metadata').send({ ...body, eventName: '' }).expect(400);
    await request(app).post('/metadata').send({ ...body, date: 'not a date' }).expect(400);
    // This assertion tests optional seat/tier fields, so Pinata must succeed in this case.
    // The default setup mock intentionally returns 404 and is used to test failure handling.
    const noSeatFetch = vi.fn(async () => new Response(JSON.stringify({ IpfsHash: CID }), { status: 200 }));
    const { app: noSeatApp } = await setup({ PINATA_JWT: 'x' }, noSeatFetch as any);
    const noSeat = await request(noSeatApp).post('/api/metadata').send({ ...body, tier: undefined, seat: undefined }).expect(201);
    expect(noSeat.body.metadata.name).toBe('Neon Nights');
    await request(app).post('/metadata').send({ ...body, image: 'http://insecure.example/a.png' }).expect(400);
    await request(app).post('/metadata').send({ ...body, image: 'javascript:alert(1)' }).expect(400);
  });
});

describe('platform', () => {
  it('serves /health and unknown routes as JSON', async () => {
    const { app } = await setup();
    expect((await request(app).get('/health').expect(200)).body.status).toBe('ok');
    expect((await request(app).get('/nope').expect(404)).body.error.code).toBe('NOT_FOUND');
    await request(app).post('/metadata').set('Content-Type', 'application/json').send('{bad').expect(400);
  });
});
