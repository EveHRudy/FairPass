import { getAddress, hexlify, isAddress, randomBytes, verifyMessage } from 'ethers';
import { randomUUID } from 'node:crypto';
import type { DB } from '../db/database.js';
import type { AppConfig } from '../config.js';
import type { ChainReader } from '../chain/ChainReader.js';
import { HttpError } from '../errors.js';
import { buildChallengeMessage, buildScannerConfirmMessage, QR_VERSION, type ChallengeFields, MESSAGE_HEADER } from '../shared/checkinMessage.js';

export { buildChallengeMessage, QR_VERSION, MESSAGE_HEADER };
export type { ChallengeFields };

export type VerifyCode =
  | 'VALID' | 'UNKNOWN_CHALLENGE' | 'EXPIRED' | 'ALREADY_CONSUMED' | 'TICKET_MISMATCH' | 'BAD_SIGNATURE'
  | 'NOT_OWNER' | 'ALREADY_USED' | 'TICKET_NOT_FOUND' | 'EVENT_MISMATCH' | 'CANNOT_VERIFY_OWNERSHIP';

export interface VerifyResult {
  valid: boolean;
  code: VerifyCode;
  message: string;
  httpStatus: number;
  ticketId?: string;
  eventId?: string;
  owner?: string;
  chainId?: number;
  contractAddress?: string;
  checkedInSource?: 'chain';
  next?: string;
}

const fail = (httpStatus: number, code: VerifyCode, message: string): VerifyResult => ({ valid: false, code, message, httpStatus });

type ChallengeRow = {
  id: string; ticket_id: string; event_id: string | null; holder: string; message: string; chain_id: number;
  contract_address: string; expires_at: number; status: string; confirmation_status: string; confirmed_tx: string | null; confirmed_block: number | null;
};

export class CheckinService {
  constructor(private db: DB, private chain: ChainReader, private cfg: AppConfig, private now: () => number = Date.now) {}

  /** Entry decisions always fail closed when ownership or used state cannot be verified on-chain. */
  private async currentOwner(ticketId: string): Promise<string | null> {
    try { return await this.chain.ownerOf(ticketId); }
    catch (error) {
      if (error instanceof HttpError && error.status === 503)
        throw new HttpError(503, 'Cannot verify ownership on-chain', 'CANNOT_VERIFY_OWNERSHIP');
      throw error;
    }
  }

  private async checkedIn(ticketId: string): Promise<boolean> {
    try {
      const onChain = await this.chain.isCheckedIn(ticketId);
      if (onChain === null) throw new HttpError(503, 'Cannot verify ticket usage on-chain', 'CANNOT_VERIFY_TICKET_STATUS');
      return onChain;
    } catch (error) {
      if (error instanceof HttpError && error.status === 503 && error.code === 'CHAIN_UNAVAILABLE')
        throw new HttpError(503, 'Cannot verify ticket usage on-chain', 'CANNOT_VERIFY_TICKET_STATUS');
      throw error;
    }
  }

  async createChallenge(input: { ticketId: string; holder: string }) {
    if (!isAddress(input.holder)) throw new HttpError(400, 'holder must be a valid address', 'MALFORMED');
    const holder = getAddress(input.holder);
    const owner = await this.currentOwner(input.ticketId);
    if (owner === null) throw new HttpError(404, 'Ticket does not exist', 'TICKET_NOT_FOUND');
    if (owner !== holder) throw new HttpError(403, 'This wallet does not own the ticket', 'NOT_OWNER');
    if (await this.checkedIn(input.ticketId)) throw new HttpError(409, 'This ticket has already been used', 'ALREADY_USED');
    const eventId = await this.chain.ticketEvent(input.ticketId);
    if (!eventId) throw new HttpError(404, 'Ticket is not associated with an existing event', 'TICKET_NOT_FOUND');
    if (!(await this.chain.eventInfo(eventId))) throw new HttpError(404, 'The ticket event does not exist', 'EVENT_NOT_FOUND');

    const issuedAt = this.now();
    const expiresAt = issuedAt + this.cfg.challengeTtlSeconds * 1000;
    const fields: ChallengeFields = {
      challengeId: randomUUID(), ticketId: input.ticketId, eventId, holder, chainId: this.cfg.chainId,
      contract: this.chain.contractAddress, nonce: hexlify(randomBytes(32)), issuedAt, expiresAt,
    };
    const message = buildChallengeMessage(fields);
    this.db.prepare(
      `INSERT INTO checkin_challenges (id, ticket_id, event_id, holder, nonce, message, chain_id, contract_address, issued_at, expires_at, status, confirmation_status)
       VALUES (?,?,?,?,?,?,?,?,?,?, 'pending', 'pending')`,
    ).run(fields.challengeId, fields.ticketId, fields.eventId, holder, fields.nonce, message, fields.chainId, fields.contract, issuedAt, expiresAt);
    this.db.prepare('DELETE FROM checkin_challenges WHERE expires_at < ?').run(issuedAt - 60 * 60 * 1000);

    return {
      challengeId: fields.challengeId, ticketId: fields.ticketId, eventId: fields.eventId, holder,
      // The nonce is public challenge data and must be returned so the frontend can rebuild
      // and validate the exact canonical message before asking the holder to sign it.
      nonce: fields.nonce,
      message, issuedAt: new Date(issuedAt).toISOString(), expiresAt: new Date(expiresAt).toISOString(),
      expiresInSeconds: this.cfg.challengeTtlSeconds, chainId: fields.chainId,
      contractAddress: fields.contract, qrVersion: QR_VERSION,
    };
  }

  async verify(input: { challengeId: string; ticketId: string; signature: string; eventId?: string }): Promise<VerifyResult> {
    const row = this.db.prepare('SELECT * FROM checkin_challenges WHERE id=?').get(input.challengeId) as ChallengeRow | undefined;
    if (!row) return fail(404, 'UNKNOWN_CHALLENGE', 'Unknown QR code. Ask the attendee to refresh their ticket.');
    if (row.status !== 'pending') return fail(409, 'ALREADY_CONSUMED', 'This QR code has already been used. Ask the attendee to refresh their ticket.');
    if (this.now() >= row.expires_at) return fail(410, 'EXPIRED', 'This QR code has expired. Ask the attendee to refresh their ticket.');
    if (row.ticket_id !== input.ticketId || (input.eventId !== undefined && row.event_id !== input.eventId))
      return fail(400, 'TICKET_MISMATCH', 'QR code does not match the challenge.');
    if (row.chain_id !== this.cfg.chainId || row.contract_address.toLowerCase() !== this.chain.contractAddress.toLowerCase())
      return fail(400, 'TICKET_MISMATCH', 'QR code was issued for a different network or contract.');

    let signer: string;
    try { signer = getAddress(verifyMessage(row.message, input.signature)); }
    catch { return fail(401, 'BAD_SIGNATURE', 'The signature is invalid.'); }

    // Preserve the challenge on RPC failure so a legitimate attendee can retry after connectivity returns.
    const owner = await this.currentOwner(row.ticket_id);
    if (owner === null) return fail(404, 'TICKET_NOT_FOUND', 'Ticket does not exist.');
    if (owner !== signer || owner.toLowerCase() !== row.holder.toLowerCase()) return fail(403, 'NOT_OWNER', 'The signer is not the current owner of this ticket.');
    const eventId = await this.chain.ticketEvent(row.ticket_id);
    if (!eventId) return fail(404, 'TICKET_NOT_FOUND', 'Ticket is not associated with an event.');
    if (eventId !== row.event_id) return fail(409, 'EVENT_MISMATCH', 'Ticket event no longer matches the challenge.');
    if (await this.checkedIn(row.ticket_id)) return fail(409, 'ALREADY_USED', 'This ticket has already been checked in.');

    const consumed = this.db.transaction(() => {
      const r = this.db.prepare(
        `UPDATE checkin_challenges SET status='consumed', consumed_at=? WHERE id=? AND status='pending' AND expires_at > ?`,
      ).run(this.now(), row.id, this.now());
      if (r.changes !== 1) return false;
      this.db.prepare(`UPDATE checkin_challenges SET status='invalidated' WHERE ticket_id=? AND status='pending' AND id<>?`).run(row.ticket_id, row.id);
      return true;
    })();
    if (!consumed) return fail(409, 'ALREADY_CONSUMED', 'This QR code has already been used. Ask the attendee to refresh their ticket.');

    return {
      valid: true, code: 'VALID', httpStatus: 200,
      message: 'Ticket is valid. Proceed with the authorized venue check-in transaction.',
      ticketId: row.ticket_id, eventId, owner, chainId: row.chain_id, contractAddress: row.contract_address,
      checkedInSource: 'chain', next: 'SUBMIT_CHECKIN_TRANSACTION',
    };
  }

  /** Submit checkIn(ticketId) from the configured organizer/venue signer, then wait for confirmation. */
  async confirm(input: { challengeId: string; ticketId: string; operatorAddress: string; operatorSignature: string; signedAt: number }) {
    const row = this.db.prepare('SELECT * FROM checkin_challenges WHERE id=?').get(input.challengeId) as ChallengeRow | undefined;
    if (!row) throw new HttpError(404, 'Unknown challenge', 'UNKNOWN_CHALLENGE');
    if (row.ticket_id !== input.ticketId) throw new HttpError(400, 'Ticket ID does not match the verified challenge', 'TICKET_MISMATCH');
    if (row.status !== 'consumed') throw new HttpError(409, 'Verify the signed QR before confirming check-in', 'VERIFY_REQUIRED');
    if (row.confirmation_status === 'confirmed' && row.confirmed_tx) {
      return { success: true, idempotent: true, ticketId: row.ticket_id, eventId: row.event_id, txHash: row.confirmed_tx, blockNumber: row.confirmed_block, status: 'confirmed' as const };
    }
    if (row.confirmation_status === 'submitting') throw new HttpError(409, 'A check-in transaction is already being submitted for this challenge', 'CHECKIN_IN_PROGRESS');

    const owner = await this.currentOwner(row.ticket_id);
    if (!owner) throw new HttpError(404, 'Ticket does not exist', 'TICKET_NOT_FOUND');
    if (owner.toLowerCase() !== row.holder.toLowerCase()) throw new HttpError(403, 'The ticket owner changed after QR verification', 'NOT_OWNER');
    const eventId = await this.chain.ticketEvent(row.ticket_id);
    if (!eventId || eventId !== row.event_id) throw new HttpError(409, 'Ticket event does not match the verified challenge', 'EVENT_MISMATCH');
    if (await this.checkedIn(row.ticket_id)) throw new HttpError(409, 'This ticket has already been checked in', 'ALREADY_USED');

    const venueAddress = this.chain.checkinSignerAddress();
    if (!venueAddress) throw new HttpError(503, 'Configure VENUE_PRIVATE_KEY for the authorized event scanner wallet', 'CHECKIN_SIGNER_NOT_CONFIGURED');
    const event = await this.chain.eventInfo(eventId);
    if (!event) throw new HttpError(404, 'Event does not exist', 'EVENT_NOT_FOUND');

    // The scanner operator must sign a fresh confirmation message. CORS alone is not authentication;
    // this prevents arbitrary Internet clients that see an attendee QR from consuming it by calling confirm.
    if (!isAddress(input.operatorAddress)) throw new HttpError(400, 'Operator address is invalid', 'INVALID_OPERATOR');
    const operatorAddress = getAddress(input.operatorAddress);
    if (!Number.isSafeInteger(input.signedAt) || Math.abs(this.now() - input.signedAt) > 60_000)
      throw new HttpError(401, 'Scanner authorization signature is stale; confirm again from the scanner wallet', 'SCANNER_SIGNATURE_EXPIRED');
    const operatorMessage = buildScannerConfirmMessage({
      challengeId: row.id, ticketId: row.ticket_id, eventId, chainId: row.chain_id,
      contract: row.contract_address, operatorAddress, signedAt: input.signedAt,
    });
    let recoveredOperator: string;
    try { recoveredOperator = getAddress(verifyMessage(operatorMessage, input.operatorSignature)); }
    catch { throw new HttpError(401, 'Scanner authorization signature is invalid', 'BAD_OPERATOR_SIGNATURE'); }
    if (recoveredOperator.toLowerCase() !== operatorAddress.toLowerCase())
      throw new HttpError(401, 'Scanner authorization signature does not match the operator wallet', 'BAD_OPERATOR_SIGNATURE');
    const operatorAuthorized = operatorAddress.toLowerCase() === event.organizer.toLowerCase() || await this.chain.isVenue(eventId, operatorAddress);
    if (!operatorAuthorized) throw new HttpError(403, 'Connected scanner wallet is not authorized for this event. The organizer must call addVenue(eventId, address).', 'OPERATOR_NOT_AUTHORIZED');

    const authorized = venueAddress.toLowerCase() === event.organizer.toLowerCase() || await this.chain.isVenue(eventId, venueAddress);
    if (!authorized) throw new HttpError(403, 'Venue wallet is not authorized for this event. The organizer must call addVenue(eventId, address) first.', 'VENUE_NOT_AUTHORIZED');

    const lock = this.db.prepare(
      `UPDATE checkin_challenges SET confirmation_status='submitting' WHERE id=? AND status='consumed' AND confirmation_status IN ('pending','failed')`,
    ).run(row.id);
    if (lock.changes !== 1) {
      const latest = this.db.prepare('SELECT confirmation_status, confirmed_tx, confirmed_block FROM checkin_challenges WHERE id=?').get(row.id) as { confirmation_status: string; confirmed_tx: string | null; confirmed_block: number | null };
      if (latest.confirmation_status === 'confirmed' && latest.confirmed_tx) {
        return { success: true, idempotent: true, ticketId: row.ticket_id, eventId, txHash: latest.confirmed_tx, blockNumber: latest.confirmed_block, status: 'confirmed' as const };
      }
      throw new HttpError(409, 'Another check-in confirmation is already in progress', 'CHECKIN_IN_PROGRESS');
    }
    try {
      const tx = await this.chain.submitCheckIn(row.ticket_id);
      this.db.prepare(`UPDATE checkin_challenges SET confirmation_status='confirmed', confirmed_tx=?, confirmed_block=? WHERE id=? AND confirmation_status='submitting'`)
        .run(tx.txHash, tx.blockNumber, row.id);
      return { success: true, idempotent: false, ticketId: row.ticket_id, eventId, txHash: tx.txHash, blockNumber: tx.blockNumber, venueAddress: tx.venueAddress, status: 'confirmed' as const };
    } catch (error) {
      this.db.prepare(`UPDATE checkin_challenges SET confirmation_status='failed' WHERE id=? AND confirmation_status='submitting'`).run(row.id);
      throw error;
    }
  }

  async status(ticketId: string) {
    const owner = await this.currentOwner(ticketId);
    if (owner === null) throw new HttpError(404, 'Ticket does not exist', 'TICKET_NOT_FOUND');
    const checkedIn = await this.checkedIn(ticketId);
    return { ticketId, owner, checkedIn, source: 'chain' as const };
  }
}
