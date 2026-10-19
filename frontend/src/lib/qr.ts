// Builds the signed payload that goes inside the entry QR code.
import { API_URL, USE_MOCK } from './config';
import { createCheckinQr as createCheckinQrHelper, encodeQrPayload } from './fairpassCheckin';
import * as mock from './mock';
import type { Web3Ctx } from '../types';

export * from './fairpassCheckin';

export interface EntryQR {
  payload: string;
  expiresAt: number; // unix seconds
}

export async function createEntryQR(ctx: Web3Ctx, ticketId: number): Promise<EntryQR> {
  if (USE_MOCK) {
    const challenge = await mock.requestChallenge(ticketId);
    const payload = encodeQrPayload({
      v: 1,
      challengeId: crypto.randomUUID(),
      ticketId: String(ticketId),
      signature: '0x' + '00'.repeat(65),
    });
    return { payload, expiresAt: challenge.expiresAt };
  }

  if (!ctx.signer) throw new Error('Connect your wallet first.');

  const res = await createCheckinQrHelper({
    apiBase: API_URL,
    ticketId,
    signer: ctx.signer,
  });

  return {
    payload: res.payload,
    expiresAt: Math.floor(res.expiresAt.getTime() / 1000),
  };
}
