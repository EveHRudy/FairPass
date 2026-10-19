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
  eventName?: string;
  eventDate?: number; // unix seconds
  eventVenue?: string;
  eventFaceValue?: string; // wei
}

export interface Listing {
  ticketId: number;
  eventId: number;
  seller: string;
  price: string; // wei
  eventName?: string;
  eventDate?: number; // unix seconds
  faceValue?: string; // wei
  royaltyPercent?: number;
}

export type TicketStatus = 'valid' | 'listed' | 'used';

export interface Challenge {
  nonce: string;
  timestamp: number; // unix seconds
  expiresAt: number; // unix seconds
  message?: string; // exact string to sign, if the backend provides it
  challengeId?: string;
  ticketId?: string;
  eventId?: string;
  holder?: string;
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
