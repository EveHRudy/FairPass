// Write-side actions (transactions) plus a few direct contract reads.
import type { ContractTransactionResponse } from 'ethers';
import { CONTRACT_ADDRESS, getContract } from './contract';
import { USE_MOCK } from './config';
import * as mock from './mock';
import * as api from './api';
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

/**
 * Buy a ticket. The deployed contract requires a metadata URI:
 *   buyTicket(uint256 eventId, string uri) payable
 *
 * In real mode we first upload metadata to the backend (POST /api/metadata),
 * which pins it to IPFS via Pinata and returns the URI. That URI is then
 * passed to the contract call. In mock mode the metadata step is skipped.
 */
export async function buyTicket(ctx: Web3Ctx, event: EventInfo) {
  if (USE_MOCK) return mock.buyTicket(event.id, ctx.address);

  // Step 1: Upload metadata to get an IPFS URI
  const eventDate = new Date(event.date * 1000).toISOString();
  const meta = await api.uploadMetadata({
    eventId: event.id,
    eventName: event.name,
    date: eventDate,
    venue: event.venue ?? 'TBA',
    description: `Ticket for ${event.name}`,
  });

  // Step 2: Buy the ticket with the metadata URI
  return send(ctx, (c) => c.buyTicket(event.id, meta.uri, { value: BigInt(event.faceValue) }));
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
  // Contract: createEvent(string name, uint256 date, uint256 faceValue, uint256 supply, uint8 capPercent, uint8 royaltyPercent)
  return send(ctx, (c) =>
    c.createEvent(input.name, input.date, input.faceValueWei, input.supply, input.capPercent, input.royaltyPercent),
  );
}

/**
 * Add or remove a venue scanner. The deployed contract requires an eventId:
 *   addVenue(uint256 eventId, address venue)
 *   removeVenue(uint256 eventId, address venue)
 */
export function setVenue(ctx: Web3Ctx, eventId: number, venue: string, add: boolean) {
  if (USE_MOCK) return mock.setVenue(venue, add);
  return send(ctx, (c) => (add ? c.addVenue(eventId, venue) : c.removeVenue(eventId, venue)));
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
  // events(id) returns: (address organizer, uint256 date, uint256 faceValue, uint256 supply, uint256 sold, uint8 capPercent, uint8 royaltyPercent)
  const ev = await contractFor(ctx).events(eventId);
  return Number(ev[5]); // capPercent is at index 5
}
