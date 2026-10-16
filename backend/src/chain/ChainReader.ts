/** One decoded contract log. BigInt arguments are converted to decimal strings. */
export interface RawLog {
  blockNumber: number;
  blockHash: string;
  txHash: string;
  logIndex: number;
  eventName: string;
  args: Record<string, string | boolean>;
}

export interface EventInfo {
  eventId: string;
  organizer: string;
  date: string;
  faceValueWei: string;
  supply: string;
  sold: string;
  capPercent: number;
  royaltyPercent: number;
}

export interface CheckinTransaction {
  txHash: string;
  blockNumber: number;
  status: 'confirmed';
  venueAddress: string;
}

export interface ResalePolicy {
  capPercent: number | null;
  capSource: 'contract' | 'config-fallback' | 'unavailable';
  royaltyPercent: number | null;
  royaltySource: 'contract' | 'config-fallback' | 'unavailable';
}

/** Production implementation uses ethers.js v6; tests use an in-memory fake. */
export interface ChainReader {
  readonly contractAddress: string;
  chainId(): Promise<number>;
  blockNumber(): Promise<number>;
  blockInfo(blockNumber: number): Promise<{ hash: string; timestamp: number } | null>;
  getLogs(fromBlock: number, toBlock: number): Promise<RawLog[]>;
  ownerOf(tokenId: string): Promise<string | null>;
  /** `used(uint256)` in the deployed TicketNFT ABI. Null is not acceptable for entry verification. */
  isCheckedIn(tokenId: string): Promise<boolean | null>;
  ticketEvent(tokenId: string): Promise<string | null>;
  tokenURI(tokenId: string): Promise<string | null>;
  listingPrice(tokenId: string): Promise<string>;
  maxResalePrice(tokenId: string): Promise<string>;
  eventInfo(eventId: string): Promise<EventInfo | null>;
  isVenue(eventId: string, venueAddress: string): Promise<boolean>;
  checkinSignerAddress(): string | null;
  submitCheckIn(ticketId: string): Promise<CheckinTransaction>;
  deploymentBlock(): Promise<number | null>;
  /** Legacy/global policy reader retained for compatibility with earlier tests and integrations. */
  resalePolicy(): Promise<ResalePolicy>;
}
