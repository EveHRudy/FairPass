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

// Revert strings matching the deployed TicketNFT contract (Person 1 + 2)
const KNOWN_REVERTS: Array<[string, string]> = [
  ['Bad payment', 'The amount sent does not match the ticket price.'],
  ['Sold out', 'This event is sold out.'],
  ['Wallet limit reached', 'You have reached the purchase limit (4 per wallet) for this event.'],
  ['Above cap', 'The price is above the resale cap for this event.'],
  ['Resale locked', 'Resale is closed for this event (within 24 hours of start).'],
  ['Ticket used', 'This ticket has already been used.'],
  ['Use marketplace', 'Tickets can only be resold through the marketplace.'],
  ['Not owner', 'You do not own this ticket.'],
  ['Not listed', 'This ticket is not listed for resale.'],
  ['Own ticket', 'You cannot buy your own ticket.'],
  ['Max resales reached', 'This ticket has reached the maximum number of resales (2).'],
  ['Bad price', 'Listing price must be above 0.'],
  ['Bad date', 'Event date must be in the future.'],
  ['Bad face value', 'Ticket price must be above 0.'],
  ['Bad supply', 'Supply must be above 0.'],
  ['Bad cap', 'Resale cap must be between 0 and 100.'],
  ['Bad royalty', 'Royalty must be between 0 and 50.'],
  ['No such event', 'This event does not exist.'],
  ['Event passed', 'This event has already ended.'],
  ['Already used', 'This ticket has already been checked in.'],
  ['Not authorized', 'You are not authorized to perform this action.'],
  ['Bad venue', 'Invalid venue address.'],
  ['Nothing to withdraw', 'You have no funds available to withdraw.'],
  ['Withdraw failed', 'The withdrawal transaction failed.'],
  ['Burn disabled', 'Tickets cannot be burned.'],
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
