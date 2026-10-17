import type { JsonRpcSigner } from 'ethers';

/** Mirrors the shared EventInfo struct agreed by Person 1 and 2. Money values are wei strings. */
export interface EventInfo {
  id: number;
  name: string;
  date: number; // unix seconds
  venue?: string;
  faceValue: string; // wei
  supply: number;
  sold: number;
  capPercent: number;
  royaltyPercent: number;
  organizer: string;
  // INTEGRATION (Person 5): expose total royalties per event from the indexer (sum of Sold events) as this field
  royaltyEarned?: string; // wei
}

export interface Ticket {
  id: number;
  eventId: number;
  owner: string;
  used: boolean;
  listed: boolean;
  listPrice?: string; // wei
  tokenURI?: string;
}

export interface Listing {
  ticketId: number;
  eventId: number;
  seller: string;
  price: string; // wei
}

export type TicketStatus = 'valid' | 'listed' | 'used';

export interface Challenge {
  nonce: string;
  timestamp: number; // unix seconds
  expiresAt: number; // unix seconds
  message?: string; // exact string to sign, if the backend provides it
}

export interface Web3Ctx {
  signer: JsonRpcSigner | null;
  address: string;
}

export interface NewEventInput {
  name: string;
  date: number;
  faceValueWei: bigint;
  supply: number;
  capPercent: number;
  royaltyPercent: number;
}
