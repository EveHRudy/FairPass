// Read-side data. In real mode everything comes from Person 5's Express backend (indexer).
import { API_URL, USE_MOCK } from './config';
import * as mock from './mock';
import type { Challenge, EventInfo, Listing, Ticket } from '../types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, init);
  } catch {
    throw new Error('Cannot reach the backend. Check that the server is running and VITE_API_URL is correct.');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const msg = body?.error?.message ?? body?.message ?? `Backend returned ${res.status} for ${path}.`;
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

// --------------- response shape adapters ---------------
// The backend returns paginated/nested objects with different field names.
// These functions map backend shapes to the flat frontend types used by all pages.

function parseUnixDate(d: string | number | null | undefined): number {
  if (d === null || d === undefined) return 0;
  if (typeof d === 'number') return d;
  // If it looks like a unix timestamp string (9-11 digits), parse as-is
  if (/^\d{9,11}$/.test(d)) return Number(d);
  // Otherwise treat as ISO string
  return Math.floor(new Date(d).getTime() / 1000);
}

function mapEvent(raw: any): EventInfo {
  return {
    id: Number(raw.eventId ?? raw.id),
    name: raw.name ?? raw.eventName ?? '',
    date: parseUnixDate(raw.date),
    venue: raw.venue ?? undefined,
    faceValue: raw.faceValueWei ?? raw.faceValue ?? '0',
    supply: Number(raw.totalSupply ?? raw.supply ?? 0),
    sold: Number(raw.ticketsSold ?? raw.sold ?? 0),
    capPercent: Number(raw.capPercent ?? 0),
    royaltyPercent: Number(raw.royaltyPercent ?? 0),
    organizer: raw.organizer ?? '',
    royaltyEarned: raw.royaltyEarned ?? undefined,
  };
}

function mapListing(raw: any): Listing {
  return {
    ticketId: Number(raw.ticketId),
    eventId: Number(raw.event?.eventId ?? raw.eventId),
    seller: raw.seller ?? '',
    price: raw.resalePriceWei ?? raw.price ?? '0',
    // Extra fields from backend enrichment
    eventName: raw.event?.name ?? undefined,
    eventDate: raw.event?.date ? parseUnixDate(raw.event.date) : undefined,
    faceValue: raw.faceValueWei ?? undefined,
    royaltyPercent: raw.royaltyPercent ?? undefined,
  };
}

function mapTicket(raw: any, address: string): Ticket {
  return {
    id: Number(raw.ticketId ?? raw.id),
    eventId: Number(raw.event?.eventId ?? raw.eventId),
    owner: address,
    used: raw.status === 'used',
    listed: raw.status === 'listed' || raw.listed === true,
    listPrice: raw.listingPriceWei ?? raw.listPrice ?? undefined,
    tokenURI: raw.tokenUri ?? raw.tokenURI ?? undefined,
    // Carry nested event metadata for the tickets page
    eventName: raw.event?.name ?? undefined,
    eventDate: raw.event?.date ? parseUnixDate(raw.event.date) : undefined,
    eventVenue: raw.event?.venue ?? undefined,
    eventFaceValue: raw.event?.faceValueWei ?? undefined,
  };
}

// --------------- API functions ---------------

export const getEvents = async (): Promise<EventInfo[]> => {
  if (USE_MOCK) return mock.getEvents();
  const data = await request<any>('/events?pageSize=100');
  // Backend returns { events: [...] } paginated wrapper
  const events = Array.isArray(data) ? data : (data.events ?? []);
  return events.map(mapEvent);
};

export const getEvent = async (id: number): Promise<EventInfo> => {
  if (USE_MOCK) return mock.getEvent(id);
  const raw = await request<any>(`/events/${id}`);
  return mapEvent(raw);
};

export const getListings = async (): Promise<Listing[]> => {
  if (USE_MOCK) return mock.getListings();
  const data = await request<any>('/listings?pageSize=100');
  const listings = Array.isArray(data) ? data : (data.listings ?? []);
  return listings.map(mapListing);
};

export const getTickets = async (address: string): Promise<Ticket[]> => {
  if (USE_MOCK) return mock.getTickets(address);
  const data = await request<any>(`/tickets/${address}`);
  const tickets = Array.isArray(data) ? data : (data.tickets ?? []);
  return tickets.map((t: any) => mapTicket(t, address));
};

export async function getOrganizerEvents(address: string): Promise<EventInfo[]> {
  const all = await getEvents();
  return all.filter((e) => e.organizer.toLowerCase() === address.toLowerCase() || (USE_MOCK && mock.isMockOrganizer(e)));
}

// Challenge response from the backend (POST /api/checkin/challenge)
export interface BackendChallenge {
  challengeId: string;
  ticketId: string;
  eventId: string;
  holder: string;
  nonce: string;
  message: string;
  issuedAt: string;
  expiresAt: string;
  expiresInSeconds: number;
  chainId: number;
  contractAddress: string;
  qrVersion: number;
}

export const requestChallenge = async (ticketId: number, holder: string): Promise<BackendChallenge> => {
  if (USE_MOCK) {
    const c = await mock.requestChallenge(ticketId);
    // Wrap mock response to match backend shape
    return {
      challengeId: crypto.randomUUID(),
      ticketId: String(ticketId),
      eventId: '1',
      holder,
      nonce: c.nonce,
      message: `FairPass Entry Challenge v1\nChallenge ID: mock\nTicket ID: ${ticketId}\nNonce: ${c.nonce}`,
      issuedAt: new Date(c.timestamp * 1000).toISOString(),
      expiresAt: new Date(c.expiresAt * 1000).toISOString(),
      expiresInSeconds: 30,
      chainId: 11155111,
      contractAddress: '0x0000000000000000000000000000000000000000',
      qrVersion: 1,
    };
  }
  return request<BackendChallenge>('/checkin/challenge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticketId: String(ticketId), holder }),
  });
};

// Metadata upload (POST /api/metadata) — required before buyTicket
export interface MetadataUploadInput {
  eventId: number;
  eventName: string;
  date: string; // ISO-8601
  venue: string;
  description?: string;
}

export interface MetadataUploadResult {
  cid: string;
  uri: string;
  ipfsUri: string | null;
  gatewayUrl: string;
  metadata: any;
  local?: boolean;
}

export const uploadMetadata = async (input: MetadataUploadInput): Promise<MetadataUploadResult> => {
  return request<MetadataUploadResult>('/metadata', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      eventId: String(input.eventId),
      eventName: input.eventName,
      description: input.description ?? `Ticket for ${input.eventName}`,
      date: input.date,
      venue: input.venue || 'TBA',
    }),
  });
};

// --------------- Development & Test Account APIs ---------------

export interface DevAccount {
  index: number;
  label: string;
  role: string;
  address: string;
  balanceWei: string;
  balanceEth: string;
  description: string;
}

export interface DevAccountsResponse {
  chainId: number;
  networkName: string;
  isLocal: boolean;
  accounts: DevAccount[];
  importInstructions: string;
}

export interface ChainStatusResponse {
  connected: boolean;
  chainId: number;
  networkName: string;
  blockNumber: number | null;
  contractAddress: string;
  isLocal: boolean;
  rpcUrl: string;
  explorerUrl: string | null;
  instructions: string | null;
}

export const getDevAccounts = async (): Promise<DevAccountsResponse> => {
  return request<DevAccountsResponse>('/dev/accounts');
};

export const getChainStatus = async (): Promise<ChainStatusResponse> => {
  return request<ChainStatusResponse>('/dev/chain');
};

export const getDevBalance = async (address: string): Promise<{ address: string; balanceWei: string; balanceEth: string }> => {
  return request<{ address: string; balanceWei: string; balanceEth: string }>(`/dev/balance/${encodeURIComponent(address)}`);
};

