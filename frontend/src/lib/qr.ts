// Builds the signed payload that goes inside the entry QR code.
import { USE_MOCK } from './config';
import { requestChallenge } from './api';
import type { Web3Ctx } from '../types';

export interface EntryQR {
  payload: string;
  expiresAt: number; // unix seconds
}

export async function createEntryQR(ctx: Web3Ctx, ticketId: number): Promise<EntryQR> {
  const challenge = await requestChallenge(ticketId);

  // INTEGRATION (Person 5): this message must match exactly what the backend rebuilds when it recovers the signer
  const message =
    challenge.message ?? `Stubline entry\nticket:${ticketId}\nnonce:${challenge.nonce}\nts:${challenge.timestamp}`;

  let signature = '0xmocksignature';
  if (!USE_MOCK) {
    if (!ctx.signer) throw new Error('Connect your wallet first.');
    signature = await ctx.signer.signMessage(message);
  }

  // INTEGRATION (Person 5): the scanner's /checkin/verify must accept this JSON shape
  const payload = JSON.stringify({ ticketId, nonce: challenge.nonce, timestamp: challenge.timestamp, signature });
  return { payload, expiresAt: challenge.expiresAt };
}
