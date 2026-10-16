import { getAddress, Wallet } from 'ethers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/database.js';
import { CheckinService } from '../src/services/checkinService.js';
import { buildScannerConfirmMessage } from '../src/shared/checkinMessage.js';
import { FakeChain } from '../src/testing/fakeChain.js';
import { testConfig } from './helpers.js';

let chain: FakeChain, svc: CheckinService, db: ReturnType<typeof openDatabase>, now: number;
const alice = Wallet.createRandom(), mallory = Wallet.createRandom();

beforeEach(() => {
  chain = new FakeChain();
  // Challenges require an existing event because event binding is verified on-chain.
  chain.createEvent(1, chain.venueWalletAddress, 'Test Event', 'Hall A', '1000000000000000000', 100);
  chain.mint(1, 1, alice.address);
  db = openDatabase(':memory:');
  now = 1_800_000_000_000;
  svc = new CheckinService(db, chain, testConfig(), () => now);
});
afterEach(() => { if (db?.open) db.close(); });

const issue = (ticketId = '1', holder = alice.address) => svc.createChallenge({ ticketId, holder });
const status = (id: string) => (db.prepare('SELECT status FROM checkin_challenges WHERE id=?').get(id) as { status: string }).status;
const confirmInput = async (c: { challengeId: string; ticketId: string; eventId: string; chainId: number; contractAddress: string }, operator = alice) => {
  chain.authorizeVenue(c.eventId, operator.address);
  const operatorAddress = getAddress(operator.address);
  const signedAt = now;
  const message = buildScannerConfirmMessage({ challengeId: c.challengeId, ticketId: c.ticketId, eventId: c.eventId, chainId: c.chainId, contract: c.contractAddress, operatorAddress, signedAt });
  return { challengeId: c.challengeId, ticketId: c.ticketId, operatorAddress, operatorSignature: await operator.signMessage(message), signedAt };
};

describe('challenge creation', () => {
  it('binds ticket, chain, contract, holder and a 30s expiry into the signed message', async () => {
    const c = await issue();
    expect(c.message).toContain(`Ticket ID: 1`);
    expect(c.message).toContain(`Chain ID: 11155111`);
    expect(c.message).toContain(`Contract: ${chain.contractAddress}`);
    expect(c.message).toContain(`Holder: ${alice.address}`);
    expect(new Date(c.expiresAt).getTime() - new Date(c.issuedAt).getTime()).toBe(30_000);
    expect(c.message).toMatch(/Nonce: 0x[0-9a-f]{64}/);
  });
  it('produces unique unpredictable nonces', async () => {
    const [a, b] = await Promise.all([issue(), issue()]);
    expect(a.challengeId).not.toBe(b.challengeId);
    expect(a.message).not.toBe(b.message);
  });
  it('rejects non-owner, unknown ticket and already-used ticket', async () => {
    await expect(issue('1', mallory.address)).rejects.toMatchObject({ status: 403, code: 'NOT_OWNER' });
    await expect(issue('99')).rejects.toMatchObject({ status: 404 });
    chain.checkIn(1);
    await expect(issue()).rejects.toMatchObject({ status: 409, code: 'ALREADY_USED' });
  });
});

describe('verification', () => {
  it('accepts a valid signature once, then rejects replay', async () => {
    const c = await issue();
    const sig = await alice.signMessage(c.message);
    const ok = await svc.verify({ challengeId: c.challengeId, ticketId: '1', signature: sig });
    expect(ok).toMatchObject({ valid: true, code: 'VALID', httpStatus: 200, owner: alice.address });
    expect(status(c.challengeId)).toBe('consumed');
    const replay = await svc.verify({ challengeId: c.challengeId, ticketId: '1', signature: sig });
    expect(replay).toMatchObject({ valid: false, code: 'ALREADY_CONSUMED', httpStatus: 409 });
  });
  it('rejects expired challenges', async () => {
    const c = await issue();
    const sig = await alice.signMessage(c.message);
    now += 30_000;
    expect(await svc.verify({ challengeId: c.challengeId, ticketId: '1', signature: sig })).toMatchObject({ valid: false, code: 'EXPIRED', httpStatus: 410 });
  });
  it('rejects unknown challenge ids', async () => {
    const r = await svc.verify({ challengeId: '00000000-0000-4000-8000-000000000000', ticketId: '1', signature: '0x' + '11'.repeat(65) });
    expect(r).toMatchObject({ valid: false, code: 'UNKNOWN_CHALLENGE' });
  });
  it('rejects a signature from the wrong wallet without burning the challenge', async () => {
    const c = await issue();
    const bad = await svc.verify({ challengeId: c.challengeId, ticketId: '1', signature: await mallory.signMessage(c.message) });
    expect(bad).toMatchObject({ valid: false, code: 'NOT_OWNER', httpStatus: 403 });
    expect(status(c.challengeId)).toBe('pending');
    expect((await svc.verify({ challengeId: c.challengeId, ticketId: '1', signature: await alice.signMessage(c.message) })).valid).toBe(true);
  });
  it('rejects malformed signatures and signatures over a different message', async () => {
    const c = await issue();
    expect(await svc.verify({ challengeId: c.challengeId, ticketId: '1', signature: '0x' + '00'.repeat(65) })).toMatchObject({ code: 'BAD_SIGNATURE' });
    const other = await alice.signMessage('something else entirely');
    expect(await svc.verify({ challengeId: c.challengeId, ticketId: '1', signature: other })).toMatchObject({ valid: false, code: 'NOT_OWNER' });
    expect(status(c.challengeId)).toBe('pending');
  });
  it('rejects a tampered ticket id in the QR payload', async () => {
    chain.mint(2, 1, alice.address);
    const c = await issue('1');
    const sig = await alice.signMessage(c.message);
    expect(await svc.verify({ challengeId: c.challengeId, ticketId: '2', signature: sig })).toMatchObject({ valid: false, code: 'TICKET_MISMATCH' });
  });
  it('rejects if ownership changed after the QR was made', async () => {
    const c = await issue();
    const sig = await alice.signMessage(c.message);
    chain.owners.set('1', mallory.address); // sold between QR creation and scan
    expect(await svc.verify({ challengeId: c.challengeId, ticketId: '1', signature: sig })).toMatchObject({ valid: false, code: 'NOT_OWNER' });
  });
  it('rejects tickets already checked in on-chain', async () => {
    const c = await issue();
    const sig = await alice.signMessage(c.message);
    chain.checkIn(1);
    expect(await svc.verify({ challengeId: c.challengeId, ticketId: '1', signature: sig })).toMatchObject({ valid: false, code: 'ALREADY_USED' });
  });
  it('lets exactly one of many simultaneous scans succeed', async () => {
    const c = await issue();
    const sig = await alice.signMessage(c.message);
    const results = await Promise.all(Array.from({ length: 25 }, () => svc.verify({ challengeId: c.challengeId, ticketId: '1', signature: sig })));
    expect(results.filter((r) => r.valid)).toHaveLength(1);
    expect(results.filter((r) => r.code === 'ALREADY_CONSUMED')).toHaveLength(24);
  });
  it('voids other pending QR codes for the same ticket after a successful scan', async () => {
    const a = await issue(), b = await issue();
    await svc.verify({ challengeId: a.challengeId, ticketId: '1', signature: await alice.signMessage(a.message) });
    expect(status(b.challengeId)).toBe('invalidated');
    expect(await svc.verify({ challengeId: b.challengeId, ticketId: '1', signature: await alice.signMessage(b.message) })).toMatchObject({ code: 'ALREADY_CONSUMED' });
  });
  it('does not consume the challenge when the RPC is down', async () => {
    const c = await issue();
    const sig = await alice.signMessage(c.message);
    chain.failures = 1;
    await expect(svc.verify({ challengeId: c.challengeId, ticketId: '1', signature: sig })).rejects.toMatchObject({ status: 503, code: 'CANNOT_VERIFY_OWNERSHIP' });
    expect(status(c.challengeId)).toBe('pending');
    expect((await svc.verify({ challengeId: c.challengeId, ticketId: '1', signature: sig })).valid).toBe(true);
  });
  it('fails closed when the chain cannot verify ticket-used status', async () => {
    const c = await issue();
    chain.hasStatusGetter = false;
    await expect(svc.verify({ challengeId: c.challengeId, ticketId: '1', signature: await alice.signMessage(c.message) }))
      .rejects.toMatchObject({ status: 503, code: 'CANNOT_VERIFY_TICKET_STATUS' });
    expect(status(c.challengeId)).toBe('pending');
  });

  it('submits check-in only after verification and returns a confirmed transaction', async () => {
    const c = await issue();
    const sig = await alice.signMessage(c.message);
    expect((await svc.verify({ challengeId: c.challengeId, ticketId: '1', signature: sig })).valid).toBe(true);
    const input = await confirmInput(c);
    const result = await svc.confirm(input);
    expect(result).toMatchObject({ success: true, status: 'confirmed', ticketId: '1', eventId: '1' });
    expect(chain.checked.has('1')).toBe(true);
    expect(await svc.confirm(input)).toMatchObject({ success: true, idempotent: true });
  });

  it('rejects check-in confirmation when the backend venue is not authorized', async () => {
    chain.eventRecords.get('1')!.organizer = mallory.address;
    const c = await issue();
    const sig = await alice.signMessage(c.message);
    expect((await svc.verify({ challengeId: c.challengeId, ticketId: '1', signature: sig })).valid).toBe(true);
    const input = await confirmInput(c);
    await expect(svc.confirm(input)).rejects.toMatchObject({ status: 403, code: 'VENUE_NOT_AUTHORIZED' });
    expect(chain.checked.has('1')).toBe(false);
  });
});
