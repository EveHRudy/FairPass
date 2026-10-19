// Write-side actions (transactions) plus a few direct contract reads.
import type { ContractTransactionResponse } from 'ethers';
import { CONTRACT_ADDRESS, getContract } from './contract';
import { USE_MOCK } from './config';
import * as mock from './mock';
import type { Contract } from 'ethers';
import type { EventInfo, Listing, NewEventInput, Web3Ctx } from '../types';

function contractFor(ctx: Web3Ctx): Contract {
  if (!ctx.signer) throw new Error('Connect your wallet first.');
  if (!CONTRACT_ADDRESS) throw new Error('Contract address is missing. Set VITE_CONTRACT_ADDRESS in .env.');
  return getContract(ctx.signer);
}

/** Sends a transaction, waits for it to be mined, returns the tx hash. */
async function send(ctx: Web3Ctx, call: (c: Contract) => Promise<ContractTransactionResponse>): Promise<string> {
  const tx = await call(contractFor(ctx));
  await tx.wait();
  return tx.hash;
}

export function buyTicket(ctx: Web3Ctx, event: EventInfo) {
  if (USE_MOCK) return mock.buyTicket(event.id, ctx.address);
  return send(ctx, (c) => c.buyTicket(event.id, { value: BigInt(event.faceValue) }));
}

export function listForResale(ctx: Web3Ctx, ticketId: number, priceWei: bigint) {
  if (USE_MOCK) return mock.listForResale(ticketId, priceWei, ctx.address);
  return send(ctx, (c) => c.listForResale(ticketId, priceWei));
}

export function cancelListing(ctx: Web3Ctx, ticketId: number) {
  if (USE_MOCK) return mock.cancelListing(ticketId, ctx.address);
  return send(ctx, (c) => c.cancelListing(ticketId));
}

export function buyResale(ctx: Web3Ctx, listing: Listing) {
  if (USE_MOCK) return mock.buyResale(listing.ticketId, ctx.address);
  return send(ctx, (c) => c.buyResale(listing.ticketId, { value: BigInt(listing.price) }));
}

export function withdraw(ctx: Web3Ctx) {
  if (USE_MOCK) return mock.withdraw(ctx.address);
  return send(ctx, (c) => c.withdraw());
}

export function createEvent(ctx: Web3Ctx, input: NewEventInput) {
  if (USE_MOCK) return mock.createEvent(input, ctx.address);
  // INTEGRATION (Person 1): argument order must match createEvent in the contract
  return send(ctx, (c) =>
    c.createEvent(input.name, input.date, input.faceValueWei, input.supply, input.capPercent, input.royaltyPercent),
  );
}

export function setVenue(ctx: Web3Ctx, venue: string, add: boolean) {
  if (USE_MOCK) return mock.setVenue(venue, add);
  // INTEGRATION (Person 1): use the real venue role function names if they differ from addVenue / removeVenue
  return send(ctx, (c) => (add ? c.addVenue(venue) : c.removeVenue(venue)));
}

/** Withdrawable balance in wei (pull-payment `pending` mapping). */
export async function getPending(ctx: Web3Ctx): Promise<string> {
  if (USE_MOCK) return mock.getPending(ctx.address);
  const value: bigint = await contractFor(ctx).pending(ctx.address);
  return value.toString();
}

/** The List for Resale modal reads capPercent straight from the contract. */
export async function getCapPercent(ctx: Web3Ctx, eventId: number): Promise<number> {
  if (USE_MOCK) return mock.getCapPercent(eventId);
  // INTEGRATION (Person 1 + 2): `events(id)` must expose capPercent with that name in the ABI
  const ev = await contractFor(ctx).events(eventId);
  return Number(ev.capPercent);
}
