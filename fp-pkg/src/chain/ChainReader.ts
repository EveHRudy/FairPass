/** One decoded contract log. BigInt arguments are converted to decimal strings. */
export interface RawLog {
  blockNumber: number;
  blockHash: string;
  txHash: string;
  logIndex: number;
  eventName: string;
  args: Record<string, string | boolean>;
}

export interface ResalePolicy {
  /** percent above face value allowed on resale, e.g. 10 means +10 % */
  capPercent: number | null;
  capSource: 'contract' | 'config-fallback' | 'unavailable';
  /** organizer royalty as a percent of the resale price */
  royaltyPercent: number | null;
  royaltySource: 'contract' | 'config-fallback' | 'unavailable';
}

/**
 * Everything the backend needs from the chain. The production implementation uses ethers.js v6;
 * tests and the demo use an in-memory fake with the same interface.
 * All methods throw ChainUnavailableError on transport problems (never return guesses).
 */
export interface ChainReader {
  readonly contractAddress: string;
  chainId(): Promise<number>;
  blockNumber(): Promise<number>;
  blockInfo(blockNumber: number): Promise<{ hash: string; timestamp: number } | null>;
  getLogs(fromBlock: number, toBlock: number): Promise<RawLog[]>;
  /** Current owner, or null when the token does not exist. */
  ownerOf(tokenId: string): Promise<string | null>;
  /** null => the contract exposes no check-in status getter (caller must fall back to the index). */
  isCheckedIn(tokenId: string): Promise<boolean | null>;
  resalePolicy(): Promise<ResalePolicy>;
}
