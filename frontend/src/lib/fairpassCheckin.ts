/** Shared Person 5 -> Person 4 ticket QR helper (ethers.js v6 compatible). */
import type { Signer } from 'ethers';
import { buildChallengeMessage, buildScannerConfirmMessage, MESSAGE_HEADER, QR_VERSION } from './checkinMessage';

export { MESSAGE_HEADER, QR_VERSION };
export const QR_PREFIX = 'FP1:';

export interface QrPayload { v: 1; challengeId: string; ticketId: string; eventId?: string; signature: string }
export interface Challenge {
  challengeId: string; ticketId: string; eventId: string; holder: string; nonce: string; message: string;
  issuedAt: string; expiresAt: string; expiresInSeconds: number; chainId: number; contractAddress: string; qrVersion: number;
}
export interface CheckinQr { payload: string; challengeId: string; ticketId: string; eventId: string; expiresAt: Date }
export type VerifyCode = 'VALID' | 'UNKNOWN_CHALLENGE' | 'EXPIRED' | 'ALREADY_CONSUMED' | 'TICKET_MISMATCH' | 'BAD_SIGNATURE' | 'NOT_OWNER' | 'ALREADY_USED' | 'TICKET_NOT_FOUND' | 'EVENT_MISMATCH' | 'CANNOT_VERIFY_OWNERSHIP';
export interface VerifyResponse {
  valid: boolean; code: VerifyCode; message: string; ticketId?: string; eventId?: string; owner?: string;
  chainId?: number; contractAddress?: string; next?: string;
}
export interface ConfirmResponse { success: boolean; idempotent: boolean; ticketId: string; eventId: string; txHash: string; blockNumber: number; status: 'confirmed'; venueAddress?: string }
export class FairPassApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
const trim = (s: string) => s.replace(/\/+$/, '');

async function post(url: string, body: unknown, okStatuses: number[] = [200, 201]): Promise<{ status: number; json: any }> {
  let res: Response;
  try { res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
  catch { throw new FairPassApiError(0, 'NETWORK', 'Cannot reach the FairPass server.'); }
  const json = await res.json().catch(() => ({}));
  if (!okStatuses.includes(res.status)) {
    const e = json?.error;
    throw new FairPassApiError(res.status, e?.code ?? json?.code ?? 'ERROR', e?.message ?? json?.message ?? `Request failed (${res.status})`);
  }
  return { status: res.status, json };
}

const b64url = {
  enc: (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))),
};
export function encodeQrPayload(p: QrPayload): string { return QR_PREFIX + b64url.enc(JSON.stringify(p)); }
export function decodeQrPayload(text: string): QrPayload {
  if (!text.startsWith(QR_PREFIX)) throw new Error('Not a FairPass ticket QR code.');
  let p: any;
  try { p = JSON.parse(b64url.dec(text.slice(QR_PREFIX.length))); } catch { throw new Error('QR code is damaged or unreadable.'); }
  if (p?.v !== QR_VERSION) throw new Error(`Unsupported QR version (${String(p?.v)}). Update the app.`);
  if (typeof p.challengeId !== 'string' || !/^[0-9a-f-]{36}$/i.test(p.challengeId)) throw new Error('QR code has an invalid challenge id.');
  if (typeof p.ticketId !== 'string' || !/^\d{1,78}$/.test(p.ticketId)) throw new Error('QR code has an invalid ticket id.');
  if (p.eventId !== undefined && (typeof p.eventId !== 'string' || !/^\d{1,78}$/.test(p.eventId))) throw new Error('QR code has an invalid event id.');
  if (typeof p.signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(p.signature)) throw new Error('QR code has an invalid signature.');
  return { v: 1, challengeId: p.challengeId, ticketId: p.ticketId, ...(p.eventId !== undefined ? { eventId: p.eventId } : {}), signature: p.signature };
}

export async function requestChallenge(apiBase: string, ticketId: string | number | bigint, holder: string): Promise<Challenge> {
  const { json } = await post(`${trim(apiBase)}/checkin/challenge`, { ticketId: String(ticketId), holder });
  return json as Challenge;
}
export async function createCheckinQr(opts: { apiBase: string; ticketId: string | number | bigint; signer: Signer }): Promise<CheckinQr> {
  const holder = await opts.signer.getAddress();
  const c = await requestChallenge(opts.apiBase, opts.ticketId, holder);
  const expected = buildChallengeMessage({
    challengeId: c.challengeId, ticketId: String(opts.ticketId), eventId: c.eventId, holder: c.holder,
    chainId: c.chainId, contract: c.contractAddress, nonce: c.nonce,
    issuedAt: Date.parse(c.issuedAt), expiresAt: Date.parse(c.expiresAt),
  });
  if (c.message !== expected || !c.message.startsWith(MESSAGE_HEADER + '\n') || c.holder.toLowerCase() !== holder.toLowerCase()) {
    throw new FairPassApiError(0, 'UNEXPECTED_MESSAGE', 'Server returned an unexpected challenge; refusing to sign.');
  }
  const signature = await opts.signer.signMessage(c.message);
  const payload = encodeQrPayload({ v: 1, challengeId: c.challengeId, ticketId: c.ticketId, eventId: c.eventId, signature });
  return { payload, challengeId: c.challengeId, ticketId: c.ticketId, eventId: c.eventId, expiresAt: new Date(c.expiresAt) };
}

export async function verifyQr(apiBase: string, p: QrPayload): Promise<VerifyResponse> {
  let res: Response;
  try { res = await fetch(`${trim(apiBase)}/checkin/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) }); }
  catch { throw new FairPassApiError(0, 'NETWORK', 'Cannot reach the FairPass server.'); }
  const json = await res.json().catch(() => null);
  if (json && typeof json.valid === 'boolean') return json as VerifyResponse;
  const e = json?.error;
  throw new FairPassApiError(res.status, e?.code ?? 'ERROR', e?.message ?? `Verification failed (${res.status})`);
}
export async function confirmCheckin(apiBase: string, p: {
  challengeId: string; ticketId: string; eventId: string; chainId: number; contractAddress: string; signer: Signer;
}): Promise<ConfirmResponse> {
  const operatorAddress = await p.signer.getAddress();
  const signedAt = Date.now();
  const message = buildScannerConfirmMessage({
    challengeId: p.challengeId, ticketId: p.ticketId, eventId: p.eventId, chainId: p.chainId,
    contract: p.contractAddress, operatorAddress, signedAt,
  });
  const operatorSignature = await p.signer.signMessage(message);
  const { json } = await post(`${trim(apiBase)}/checkin/confirm`, {
    challengeId: p.challengeId, ticketId: p.ticketId, operatorAddress, operatorSignature, signedAt,
  }, [200]);
  return json as ConfirmResponse;
}
export async function getTicketStatus(apiBase: string, ticketId: string): Promise<{ ticketId: string; owner: string; checkedIn: boolean }> {
  let res: Response;
  try { res = await fetch(`${trim(apiBase)}/checkin/status/${encodeURIComponent(ticketId)}`); }
  catch { throw new FairPassApiError(0, 'NETWORK', 'Cannot reach the FairPass server.'); }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new FairPassApiError(res.status, json?.error?.code ?? 'ERROR', json?.error?.message ?? 'Status check failed');
  return json;
}
