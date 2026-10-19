import { formatEther } from 'ethers';
import { RESALE_LOCK_HOURS } from './config';
import type { EventInfo, Ticket, TicketStatus } from '../types';

export const shortAddr = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

export function fmtEth(wei: string | bigint): string {
  const [whole, dec = ''] = formatEther(wei).split('.');
  const trimmed = dec.slice(0, 6).replace(/0+$/, '');
  return trimmed ? `${whole}.${trimmed}` : whole;
}

export const fmtDate = (unix: number) =>
  new Date(unix * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export const nowSec = () => Math.floor(Date.now() / 1000);
export const remaining = (e: EventInfo) => e.supply - e.sold;
export const isPast = (e: EventInfo) => e.date <= nowSec();
export const resaleLocked = (e: EventInfo) => nowSec() >= e.date - RESALE_LOCK_HOURS * 3600;

/** Same formula as the contract: faceValue * (100 + capPercent) / 100 */
export const maxResalePrice = (faceValue: string, capPercent: number): bigint =>
  (BigInt(faceValue) * BigInt(100 + capPercent)) / 100n;

export const ticketStatus = (t: Ticket): TicketStatus => (t.used ? 'used' : t.listed ? 'listed' : 'valid');

// INTEGRATION (Person 1 + 2): replace the keys with the exact revert strings / custom errors from the contracts
const KNOWN_REVERTS: Array<[string, string]> = [
  ['Wrong payment', 'The amount sent does not match the ticket price.'],
  ['Sold out', 'This event is sold out.'],
  ['Purchase limit', 'You have reached the purchase limit for this event.'],
  ['Above cap', 'The price is above the resale cap for this event.'],
  ['Resale locked', 'Resale is closed for this event.'],
  ['Ticket used', 'This ticket has already been used.'],
  ['Transfers locked', 'Tickets can only be resold through the marketplace.'],
  ['Not owner', 'You do not own this ticket.'],
];

export function parseError(e: unknown): string {
  const err = e as any;
  if (err?.code === 'ACTION_REJECTED' || err?.code === 4001) return 'You rejected the request in your wallet.';
  if (err?.code === 'INSUFFICIENT_FUNDS') return 'Your wallet does not have enough Sepolia ETH for this.';
  const raw = String(
    err?.reason ?? err?.revert?.args?.[0] ?? err?.shortMessage ?? err?.info?.error?.message ?? err?.message ?? 'Something went wrong.',
  );
  for (const [key, message] of KNOWN_REVERTS) if (raw.includes(key)) return message;
  return raw.replace(/^execution reverted:?\s*/i, '').replace(/^Error:\s*/i, '') || 'Something went wrong.';
}
