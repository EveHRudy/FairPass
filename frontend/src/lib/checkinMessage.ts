/** Shared canonical EIP-191 message builder used by both API verification and frontend wallet signing. */
export const QR_VERSION = 1 as const;
export const MESSAGE_HEADER = 'FairPass Entry Challenge v1';

export interface ChallengeFields {
  challengeId: string;
  ticketId: string;
  eventId: string;
  holder: string;
  chainId: number;
  contract: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
}

export function buildChallengeMessage(f: ChallengeFields): string {
  return [
    MESSAGE_HEADER,
    `Challenge ID: ${f.challengeId}`,
    `Ticket ID: ${f.ticketId}`,
    `Event ID: ${f.eventId}`,
    `Holder: ${f.holder}`,
    `Chain ID: ${f.chainId}`,
    `Contract: ${f.contract}`,
    `Nonce: ${f.nonce}`,
    `Issued At: ${new Date(f.issuedAt).toISOString()}`,
    `Expires At: ${new Date(f.expiresAt).toISOString()}`,
  ].join('\n');
}

/** A scanner operator must independently authorize the request before the server signer submits checkIn. */
export const SCANNER_CONFIRM_HEADER = 'FairPass Scanner Authorization v1';
export interface ScannerConfirmFields {
  challengeId: string;
  ticketId: string;
  eventId: string;
  chainId: number;
  contract: string;
  operatorAddress: string;
  signedAt: number;
}
export function buildScannerConfirmMessage(f: ScannerConfirmFields): string {
  return [
    SCANNER_CONFIRM_HEADER,
    `Challenge ID: ${f.challengeId}`,
    `Ticket ID: ${f.ticketId}`,
    `Event ID: ${f.eventId}`,
    `Chain ID: ${f.chainId}`,
    `Contract: ${f.contract}`,
    `Operator: ${f.operatorAddress}`,
    `Signed At (ms): ${f.signedAt}`,
    'Action: confirm on-chain check-in',
  ].join('\n');
}
