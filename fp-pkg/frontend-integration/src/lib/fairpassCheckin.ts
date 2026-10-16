/**
 * FairPass check-in helper (Person 5 -> Person 4).  Framework-agnostic, ethers v6 only.
 *
 * ATTENDEE side:   const qr = await createCheckinQr({ apiBase, ticketId, signer });   // render qr.payload as a QR code
 * VENUE side:      const p = decodeQrPayload(scannedText); const r = await verifyQr(apiBase, p);
 *                  if (r.valid) -> venue wallet calls checkIn(ticketId) and waits for the receipt.
 *
 * The QR carries ONLY { v, challengeId, ticketId, signature }. Ownership / used-status are never taken from it:
 * the backend re-reads them from the contract.
 */
import type { Signer } from 'ethers';

export const QR_VERSION = 1;
export const QR_PREFIX = 'FP1:';
export const MESSAGE_HEADER = 'FairPass Entry Challenge v1';

export interface QrPayload { v: 1; challengeId: string; ticketId: string; signature: string }

export interface Challenge {
  challengeId: string; ticketId: string; message: string; issuedAt: string; expiresAt: string;
  expiresInSeconds: number; chainId: number; contractAddress: string; qrVersion: number;
}
export interface CheckinQr { payload: string; challengeId: string; ticketId: string; expiresAt: Date }

export type VerifyCode =
  | 'VALID' | 'UNKNOWN_CHALLENGE' | 'EXPIRED' | 'ALREADY_CONSUMED' | 'TICKET_MISMATCH' | 'BAD_SIGNATURE'
  | 'NOT_OWNER' | 'ALREADY_USED' | 'TICKET_NOT_FOUND';

export interface VerifyResponse {
  valid: boolean; code: VerifyCode; message: string;
  ticketId?: string; owner?: string; chainId?: number; contractAddress?: string; next?: string;
}

export class FairPassApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

const trim = (s: string) => s.replace(/\/+$/, '');

async function post(url: string, body: unknown, okStatuses: number[] = [200, 201]): Promise<{ status: number; json: any }> {
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch { throw new FairPassApiError(0, 'NETWORK', 'Cannot reach the FairPass server.'); }
  const json = await res.json().catch(() => ({}));
  if (!okStatuses.includes(res.status)) {
    const e = json?.error;
    throw new FairPassApiError(res.status, e?.code ?? 'ERROR', e?.message ?? `Request failed (${res.status})`);
  }
  return { status: res.status, json };
}

// ---------- QR payload encoding ----------
const b64url = {
  enc: (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))),
};

export function encodeQrPayload(p: QrPayload): string {
  return QR_PREFIX + b64url.enc(JSON.stringify(p));
}

/** Parses and validates a scanned string. Throws a readable Error for anything that is not a v1 FairPass QR. */
export function decodeQrPayload(text: string): QrPayload {
  if (!text.startsWith(QR_PREFIX)) throw new Error('Not a FairPass ticket QR code.');
  let p: any;
  try { p = JSON.parse(b64url.dec(text.slice(QR_PREFIX.length))); } catch { throw new Error('QR code is damaged or unreadable.'); }
  if (p?.v !== QR_VERSION) throw new Error(`Unsupported QR version (${String(p?.v)}). Update the app.`);
  if (typeof p.challengeId !== 'string' || !/^[0-9a-f-]{36}$/i.test(p.challengeId)) throw new Error('QR code has an invalid challenge id.');
  if (typeof p.ticketId !== 'string' || !/^\d{1,78}$/.test(p.ticketId)) throw new Error('QR code has an invalid ticket id.');
  if (typeof p.signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(p.signature)) throw new Error('QR code has an invalid signature.');
  return { v: 1, challengeId: p.challengeId, ticketId: p.ticketId, signature: p.signature };
}

// ---------- attendee ----------
export async function requestChallenge(apiBase: string, ticketId: string | number | bigint, holder: string): Promise<Challenge> {
  const { json } = await post(`${trim(apiBase)}/checkin/challenge`, { ticketId: String(ticketId), holder });
  return json as Challenge;
}

/**
 * Requests a fresh challenge, has the connected wallet sign it, and returns the QR payload string.
 * The challenge lives ~30 s, so call this right before showing the QR and refresh when `expiresAt` passes.
 */
export async function createCheckinQr(opts: { apiBase: string; ticketId: string | number | bigint; signer: Signer }): Promise<CheckinQr> {
  const holder = await opts.signer.getAddress();
  const c = await requestChallenge(opts.apiBase, opts.ticketId, holder);
  // Refuse to sign anything that is not exactly the FairPass entry message for THIS ticket and wallet.
  const ok = c.message.startsWith(MESSAGE_HEADER + '\n') &&
    c.message.includes(`\nTicket ID: ${String(opts.ticketId)}\n`) &&
    c.message.includes(`\nHolder: ${holder}\n`) &&
    c.message.includes(`\nChallenge ID: ${c.challengeId}\n`);
  if (!ok) throw new FairPassApiError(0, 'UNEXPECTED_MESSAGE', 'Server returned an unexpected challenge; refusing to sign.');
  const signature = await opts.signer.signMessage(c.message);   // EIP-191 personal_sign
  const payload = encodeQrPayload({ v: 1, challengeId: c.challengeId, ticketId: c.ticketId, signature });
  return { payload, challengeId: c.challengeId, ticketId: c.ticketId, expiresAt: new Date(c.expiresAt) };
}

/** Optional: renders a payload to a PNG data URL. Requires `npm i qrcode` (kept out of the helper's hard dependencies). */
export async function renderQrDataUrl(payload: string, size = 320): Promise<string> {
  const QR = await import('qrcode');
  return QR.toDataURL(payload, { errorCorrectionLevel: 'M', margin: 1, width: size });
}

// ---------- venue ----------
/**
 * Backend validation of a scanned QR. Business outcomes (expired, already used, wrong owner, ...) are RETURNED as
 * `{ valid: false, code, message }`. Only transport / server problems throw FairPassApiError (e.g. 503 chain outage:
 * the challenge is NOT consumed in that case, so the same QR can be scanned again).
 */
export async function verifyQr(apiBase: string, p: QrPayload): Promise<VerifyResponse> {
  let res: Response;
  try {
    res = await fetch(`${trim(apiBase)}/checkin/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });
  } catch { throw new FairPassApiError(0, 'NETWORK', 'Cannot reach the FairPass server.'); }
  const json = await res.json().catch(() => null);
  if (json && typeof json.valid === 'boolean') return json as VerifyResponse;
  const e = json?.error;
  throw new FairPassApiError(res.status, e?.code ?? 'ERROR', e?.message ?? `Verification failed (${res.status})`);
}

/** Authoritative on-chain status through the backend (use after the check-in transaction confirms). */
export async function getTicketStatus(apiBase: string, ticketId: string): Promise<{ ticketId: string; owner: string; checkedIn: boolean }> {
  let res: Response;
  try { res = await fetch(`${trim(apiBase)}/checkin/status/${encodeURIComponent(ticketId)}`); }
  catch { throw new FairPassApiError(0, 'NETWORK', 'Cannot reach the FairPass server.'); }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new FairPassApiError(res.status, json?.error?.code ?? 'ERROR', json?.error?.message ?? 'Status check failed');
  return json;
}
