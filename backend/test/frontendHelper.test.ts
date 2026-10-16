import type { AddressInfo } from 'node:net';
import { Wallet } from 'ethers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createCheckinQr, decodeQrPayload, encodeQrPayload, FairPassApiError, getTicketStatus, renderQrDataUrl, verifyQr } from '../frontend-integration/src/lib/fairpassCheckin.js';
import { makeIndexer, seedChain, testConfig } from './helpers.js';

let server: ReturnType<ReturnType<typeof createApp>['listen']>, base: string;
const ctx = (() => { const m = makeIndexer(); return { ...m, users: seedChain(m.chain) }; })();

beforeAll(() => {
  server = createApp({ config: testConfig(), db: ctx.db, chain: ctx.chain, silent: true }).listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server.close(); });

describe('frontend helper <-> backend', () => {
  it('QR round trip: create, decode, verify, replay', async () => {
    const qr = await createCheckinQr({ apiBase: base, ticketId: 1, signer: ctx.users.alice as any });
    expect(qr.payload.startsWith('FP1:')).toBe(true);
    expect(qr.payload.length).toBeLessThan(400);                       // fits comfortably in a QR
    const p = decodeQrPayload(qr.payload);
    expect(p).toMatchObject({ v: 1, ticketId: '1', challengeId: qr.challengeId });
    expect(await verifyQr(base, p)).toMatchObject({ valid: true, code: 'VALID' });
    expect(await verifyQr(base, p)).toMatchObject({ valid: false, code: 'ALREADY_CONSUMED' });   // 409 body is returned, not thrown
    expect(await getTicketStatus(base, '1')).toMatchObject({ checkedIn: false });
    expect((await renderQrDataUrl(qr.payload)).startsWith('data:image/png')).toBe(true);
  });
  it('wrong wallet cannot even get a challenge', async () => {
    await expect(createCheckinQr({ apiBase: base, ticketId: 1, signer: Wallet.createRandom() as any })).rejects.toMatchObject({ status: 403, code: 'NOT_OWNER' });
  });
  it('rejects unsupported / malformed QR payloads', () => {
    expect(() => decodeQrPayload('hello')).toThrow(/Not a FairPass/);
    expect(() => decodeQrPayload('FP1:@@@')).toThrow(/damaged/);
    const v2 = 'FP1:' + Buffer.from(JSON.stringify({ v: 2 })).toString('base64url');
    expect(() => decodeQrPayload(v2)).toThrow(/Unsupported QR version/);
    expect(() => decodeQrPayload(encodeQrPayload({ v: 1, challengeId: 'x', ticketId: '1', signature: '0x00' }))).toThrow(/invalid challenge id/);
  });
  it('surfaces outages as errors (QR stays usable)', async () => {
    const qr = await createCheckinQr({ apiBase: base, ticketId: 1, signer: ctx.users.alice as any });
    ctx.chain.failures = 1;
    await expect(verifyQr(base, decodeQrPayload(qr.payload))).rejects.toBeInstanceOf(FairPassApiError);
    expect(await verifyQr(base, decodeQrPayload(qr.payload))).toMatchObject({ valid: true });
  });
});
