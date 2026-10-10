import { getAddress, hexlify, isAddress, randomBytes, verifyMessage } from 'ethers';
import { randomUUID } from 'node:crypto';
import type { DB } from '../db/database.js';
import type { AppConfig } from '../config.js';
import type { ChainReader } from '../chain/ChainReader.js';
import { HttpError } from '../errors.js';

export const QR_VERSION = 1;
export const MESSAGE_HEADER = 'FairPass Entry Challenge v1';

export interface ChallengeFields {
  challengeId: string; ticketId: string; holder: string; chainId: number; contract: string;
  nonce: string; issuedAt: number; expiresAt: number;
}

/** The exact text the ticket holder signs (EIP-191 personal_sign). Stored verbatim and never rebuilt from client input. */
export function buildChallengeMessage(f: ChallengeFields): string {
  return [
    MESSAGE_HEADER,
    `Challenge ID: ${f.challengeId}`,
    `Ticket ID: ${f.ticketId}`,
    `Holder: ${f.holder}`,
    `Chain ID: ${f.chainId}`,
    `Contract: ${f.contract}`,
    `Nonce: ${f.nonce}`,
    `Issued At: ${new Date(f.issuedAt).toISOString()}`,
    `Expires At: ${new Date(f.expiresAt).toISOString()}`,
  ].join('\n');
}

export type VerifyCode =
  | 'VALID' | 'UNKNOWN_CHALLENGE' | 'EXPIRED' | 'ALREADY_CONSUMED' | 'TICKET_MISMATCH' | 'BAD_SIGNATURE'
  | 'NOT_OWNER' | 'ALREADY_USED' | 'TICKET_NOT_FOUND';

export interface VerifyResult {
  valid: boolean;
  code: VerifyCode;
  message: string;
  httpStatus: number;
  ticketId?: string;
  owner?: string;
  chainId?: number;
  contractAddress?: string;
  checkedInSource?: 'chain' | 'index';
  next?: string;
}

const fail = (httpStatus: number, code: VerifyCode, message: string): VerifyResult => ({ valid: false, code, message, httpStatus });

export class CheckinService {
  constructor(private db: DB, private chain: ChainReader, private cfg: AppConfig, private now: () => number = Date.now) {}

  private async checkedIn(ticketId: string): Promise<{ used: boolean; source: 'chain' | 'index' }> {
    const onChain = await this.chain.isCheckedIn(ticketId);
    if (onChain !== null) return { used: onChain, source: 'chain' };
    // No status getter in the ABI: fall back to indexed CheckedIn events (documented limitation).
    const row = this.db.prepare('SELECT status FROM tickets WHERE token_id=?').get(ticketId) as { status: string } | undefined;
    return { used: row?.status === 'checked_in', source: 'index' };
  }

  async createChallenge(input: { ticketId: string; holder: string }) {
    if (!isAddress(input.holder)) throw new HttpError(400, 'holder must be a valid address', 'MALFORMED');
    const holder = getAddress(input.holder);
    const owner = await this.chain.ownerOf(input.ticketId);
    if (owner === null) throw new HttpError(404, 'Ticket does not exist', 'TICKET_NOT_FOUND');
    if (owner !== holder) throw new HttpError(403, 'This wallet does not own the ticket', 'NOT_OWNER');
    const { used } = await this.checkedIn(input.ticketId);
    if (used) throw new HttpError(409, 'This ticket has already been used', 'ALREADY_USED');

    const issuedAt = this.now();
    const expiresAt = issuedAt + this.cfg.challengeTtlSeconds * 1000;
    const fields: ChallengeFields = {
      challengeId: randomUUID(), ticketId: input.ticketId, holder, chainId: this.cfg.chainId,
      contract: this.chain.contractAddress, nonce: hexlify(randomBytes(32)), issuedAt, expiresAt,
    };
    const message = buildChallengeMessage(fields);
    this.db.prepare(
      `INSERT INTO checkin_challenges (id, ticket_id, holder, nonce, message, chain_id, contract_address, issued_at, expires_at, status)
       VALUES (?,?,?,?,?,?,?,?,?, 'pending')`,
    ).run(fields.challengeId, fields.ticketId, holder, fields.nonce, message, fields.chainId, fields.contract, issuedAt, expiresAt);
    this.db.prepare('DELETE FROM checkin_challenges WHERE expires_at < ?').run(issuedAt - 60 * 60 * 1000); // housekeeping

    return {
      challengeId: fields.challengeId, ticketId: fields.ticketId, message,
      issuedAt: new Date(issuedAt).toISOString(), expiresAt: new Date(expiresAt).toISOString(),
      expiresInSeconds: this.cfg.challengeTtlSeconds, chainId: fields.chainId, contractAddress: fields.contract, qrVersion: QR_VERSION,
    };
  }

  async verify(input: { challengeId: string; ticketId: string; signature: string }): Promise<VerifyResult> {
    const row = this.db.prepare('SELECT * FROM checkin_challenges WHERE id=?').get(input.challengeId) as
      | { id: string; ticket_id: string; holder: string; message: string; chain_id: number; contract_address: string; expires_at: number; status: string }
      | undefined;

    if (!row) return fail(404, 'UNKNOWN_CHALLENGE', 'Unknown QR code. Ask the attendee to refresh their ticket.');
    if (row.status !== 'pending') return fail(409, 'ALREADY_CONSUMED', 'This QR code has already been used. Ask the attendee to refresh their ticket.');
    if (this.now() >= row.expires_at) return fail(410, 'EXPIRED', 'This QR code has expired. Ask the attendee to refresh their ticket.');
    if (row.ticket_id !== input.ticketId) return fail(400, 'TICKET_MISMATCH', 'QR code does not match the challenge.');
    if (row.chain_id !== this.cfg.chainId || row.contract_address !== this.chain.contractAddress)
      return fail(400, 'TICKET_MISMATCH', 'QR code was issued for a different network or contract.');

    let signer: string;
    try { signer = getAddress(verifyMessage(row.message, input.signature)); }
    catch { return fail(401, 'BAD_SIGNATURE', 'The signature is invalid.'); }
    // NOTE: a bad signature does NOT consume the challenge, otherwise anyone who sees a QR could burn it.

    const owner = await this.chain.ownerOf(row.ticket_id);               // may throw ChainUnavailableError -> 503, challenge untouched
    if (owner === null) return fail(404, 'TICKET_NOT_FOUND', 'Ticket does not exist.');
    if (owner !== signer) return fail(403, 'NOT_OWNER', 'The signer is not the current owner of this ticket.');
    const { used, source } = await this.checkedIn(row.ticket_id);
    if (used) return fail(409, 'ALREADY_USED', 'This ticket has already been checked in.');

    // Atomic consume: only one concurrent request can flip pending -> consumed (single SQLite statement).
    const consumed = this.db.transaction(() => {
      const r = this.db.prepare(
        `UPDATE checkin_challenges SET status='consumed', consumed_at=? WHERE id=? AND status='pending' AND expires_at > ?`,
      ).run(this.now(), row.id, this.now());
      if (r.changes !== 1) return false;
      // any other QR for the same ticket is now void
      this.db.prepare(`UPDATE checkin_challenges SET status='invalidated' WHERE ticket_id=? AND status='pending' AND id<>?`).run(row.ticket_id, row.id);
      return true;
    })();
    if (!consumed) return fail(409, 'ALREADY_CONSUMED', 'This QR code has already been used. Ask the attendee to refresh their ticket.');

    return {
      valid: true, code: 'VALID', httpStatus: 200,
      message: 'Ticket is valid. The venue wallet must now submit checkIn(ticketId) on-chain.',
      ticketId: row.ticket_id, owner, chainId: row.chain_id, contractAddress: row.contract_address,
      checkedInSource: source, next: 'SUBMIT_CHECKIN_TRANSACTION',
    };
  }

  /** Authoritative status read used by the scanner after the venue transaction confirms. */
  async status(ticketId: string) {
    const owner = await this.chain.ownerOf(ticketId);
    if (owner === null) throw new HttpError(404, 'Ticket does not exist', 'TICKET_NOT_FOUND');
    const { used, source } = await this.checkedIn(ticketId);
    return { ticketId, owner, checkedIn: used, source };
  }
}
