// In-memory fake chain + backend so the whole UI can be built and demoed without Persons 1, 2 and 5.
// Active when VITE_USE_MOCK=true. State resets on page reload.
import { parseEther } from 'ethers';
import type { EventInfo, Listing, NewEventInput, Ticket, Challenge } from '../types';
import { RESALE_LOCK_HOURS } from './config';

const HOUR = 3600;
const DAY = 86400;
const MOCK = 'mock'; // placeholder meaning "the connected user"
const SELLER_A = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
const SELLER_B = '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc';
const PER_WALLET_LIMIT = 4;

const now = () => Math.floor(Date.now() / 1000);
const sleep = (ms = 500) => new Promise<void>((r) => setTimeout(r, ms));
const fakeHash = () => '0xmock' + Math.random().toString(16).slice(2, 10);
const mine = (owner: string, me: string) => owner === MOCK || owner.toLowerCase() === me.toLowerCase();
const resolve = (a: string, me: string) => (a === MOCK ? me : a);
const key = (a: string) => a.toLowerCase();

let events: EventInfo[] = [
  { id: 1, name: 'Neon Harbor Live', venue: 'Pier 9 Arena', date: now() + 12 * DAY, faceValue: parseEther('0.05').toString(), supply: 500, sold: 342, capPercent: 10, royaltyPercent: 10, organizer: MOCK, royaltyEarned: '0' },
  { id: 2, name: 'Midnight Jazz Cellar', venue: 'The Cellar', date: now() + 5 * DAY, faceValue: parseEther('0.02').toString(), supply: 150, sold: 37, capPercent: 20, royaltyPercent: 8, organizer: MOCK, royaltyEarned: '0' },
  { id: 3, name: 'Startup Summit Keynote', venue: 'Hall B', date: now() + 10 * HOUR, faceValue: parseEther('0.1').toString(), supply: 300, sold: 288, capPercent: 10, royaltyPercent: 10, organizer: SELLER_B },
  { id: 4, name: 'Indie Film Night', venue: 'Roxy Cinema', date: now() + 20 * DAY, faceValue: parseEther('0.015').toString(), supply: 60, sold: 60, capPercent: 10, royaltyPercent: 10, organizer: SELLER_A },
];

let tickets: Ticket[] = [
  { id: 1, eventId: 1, owner: MOCK, used: false, listed: false },
  { id: 2, eventId: 2, owner: MOCK, used: false, listed: false },
  { id: 3, eventId: 3, owner: MOCK, used: false, listed: false },
  { id: 4, eventId: 1, owner: MOCK, used: true, listed: false },
  { id: 5, eventId: 1, owner: SELLER_A, used: false, listed: true, listPrice: parseEther('0.055').toString() },
  { id: 6, eventId: 2, owner: SELLER_B, used: false, listed: true, listPrice: parseEther('0.022').toString() },
];

let listings: Listing[] = [
  { ticketId: 5, eventId: 1, seller: SELLER_A, price: parseEther('0.055').toString() },
  { ticketId: 6, eventId: 2, seller: SELLER_B, price: parseEther('0.022').toString() },
];

const pending = new Map<string, bigint>();
const addPending = (addr: string, amt: bigint) => pending.set(key(addr), (pending.get(key(addr)) ?? 0n) + amt);
let nextTicketId = 100;
let nextEventId = 10;

const findEvent = (id: number) => {
  const e = events.find((x) => x.id === id);
  if (!e) throw new Error('Event not found.');
  return e;
};

// ---------- reads (stand-in for Person 5's API) ----------
export const getEvents = async () => { await sleep(250); return events.map((e) => ({ ...e })); };
export const getEvent = async (id: number) => { await sleep(200); return { ...findEvent(id) }; };
export const getListings = async () => { await sleep(250); return listings.map((l) => ({ ...l })); };
export const getTickets = async (addr: string) => { await sleep(250); return tickets.filter((t) => mine(t.owner, addr)).map((t) => ({ ...t })); };
export const getPending = async (addr: string) => (pending.get(key(addr)) ?? 0n).toString();
export const getCapPercent = async (eventId: number) => findEvent(eventId).capPercent;
export const requestChallenge = async (_ticketId: number): Promise<Challenge> => {
  await sleep(200);
  const t = now();
  return { nonce: Math.random().toString(16).slice(2, 14), timestamp: t, expiresAt: t + 30 };
};

// ---------- writes (stand-in for the contract) ----------
export async function buyTicket(eventId: number, me: string) {
  await sleep(900);
  const e = findEvent(eventId);
  if (e.sold >= e.supply) throw new Error('Sold out');
  if (tickets.filter((t) => t.eventId === eventId && mine(t.owner, me)).length >= PER_WALLET_LIMIT) throw new Error('Purchase limit');
  e.sold += 1;
  tickets.push({ id: nextTicketId++, eventId, owner: me, used: false, listed: false });
  addPending(resolve(e.organizer, me), BigInt(e.faceValue));
  return fakeHash();
}

export async function listForResale(ticketId: number, priceWei: bigint, me: string) {
  await sleep(800);
  const t = tickets.find((x) => x.id === ticketId);
  if (!t || !mine(t.owner, me)) throw new Error('Not owner');
  if (t.used) throw new Error('Ticket used');
  const e = findEvent(t.eventId);
  if (now() >= e.date - RESALE_LOCK_HOURS * HOUR) throw new Error('Resale locked');
  if (priceWei > (BigInt(e.faceValue) * BigInt(100 + e.capPercent)) / 100n) throw new Error('Above cap');
  t.owner = me; t.listed = true; t.listPrice = priceWei.toString();
  listings.push({ ticketId, eventId: e.id, seller: me, price: priceWei.toString() });
  return fakeHash();
}

export async function cancelListing(ticketId: number, me: string) {
  await sleep(700);
  const t = tickets.find((x) => x.id === ticketId);
  if (!t || !mine(t.owner, me)) throw new Error('Not owner');
  t.listed = false; t.listPrice = undefined;
  listings = listings.filter((l) => l.ticketId !== ticketId);
  return fakeHash();
}

export async function buyResale(ticketId: number, me: string) {
  await sleep(900);
  const l = listings.find((x) => x.ticketId === ticketId);
  const t = tickets.find((x) => x.id === ticketId);
  if (!l || !t) throw new Error('This listing is no longer available.');
  const e = findEvent(l.eventId);
  const price = BigInt(l.price);
  const royalty = (price * BigInt(e.royaltyPercent)) / 100n;
  listings = listings.filter((x) => x.ticketId !== ticketId); // delete listing first
  addPending(resolve(e.organizer, me), royalty);
  addPending(resolve(l.seller, me), price - royalty); // seller + royalty always equals price
  e.royaltyEarned = (BigInt(e.royaltyEarned ?? '0') + royalty).toString();
  t.owner = me; t.listed = false; t.listPrice = undefined;
  return fakeHash();
}

export async function withdraw(me: string) {
  await sleep(700);
  pending.set(key(me), 0n);
  return fakeHash();
}

export async function createEvent(input: NewEventInput, me: string) {
  await sleep(900);
  events.push({
    id: nextEventId++, name: input.name, date: input.date, faceValue: input.faceValueWei.toString(),
    supply: input.supply, sold: 0, capPercent: input.capPercent, royaltyPercent: input.royaltyPercent,
    organizer: me, royaltyEarned: '0',
  });
  return fakeHash();
}

export const setVenue = async (_venue: string, _add: boolean) => { await sleep(600); return fakeHash(); };
export const isMockOrganizer = (e: EventInfo) => e.organizer === MOCK;
