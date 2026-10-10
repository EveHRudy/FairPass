/**
 * Event argument names differ between contract implementations. The indexer never invents ABI
 * entries: it decodes with the real ABI, then looks up each logical field through this alias table.
 * Override/extend with EVENT_ARG_MAP_JSON, e.g. {"price":["faceValue","cost"]}.
 */
export type LogicalField =
  | 'eventId' | 'tokenId' | 'name' | 'date' | 'venue' | 'organizer' | 'price' | 'maxSupply'
  | 'owner' | 'seller' | 'buyer' | 'tokenURI' | 'metadataURI';

export const DEFAULT_ALIASES: Record<LogicalField, string[]> = {
  eventId: ['eventId', 'event_id', 'eventID'],
  tokenId: ['tokenId', 'ticketId', 'token_id', 'tokenID', 'id'],
  name: ['name', 'eventName', 'title'],
  date: ['date', 'eventDate', 'startTime', 'timestamp', 'eventTime'],
  venue: ['venue', 'location'],
  organizer: ['organizer', 'creator', 'organiser'],
  price: ['price', 'faceValue', 'ticketPrice', 'basePrice', 'salePrice', 'resalePrice', 'amount'],
  maxSupply: ['maxSupply', 'totalSupply', 'capacity', 'supply', 'totalTickets', 'maxTickets'],
  owner: ['owner', 'to', 'buyer', 'attendee'],
  seller: ['seller', 'from', 'owner'],
  buyer: ['buyer', 'to', 'newOwner'],
  tokenURI: ['tokenURI', 'tokenUri', 'uri', 'metadataURI'],
  metadataURI: ['metadataURI', 'metadataUri', 'uri', 'baseURI'],
};

export class ArgMap {
  private aliases: Record<LogicalField, string[]>;
  constructor(overrideJson?: string) {
    this.aliases = { ...DEFAULT_ALIASES };
    if (overrideJson) {
      const o = JSON.parse(overrideJson) as Partial<Record<LogicalField, string[]>>;
      for (const [k, v] of Object.entries(o)) this.aliases[k as LogicalField] = [...v, ...(this.aliases[k as LogicalField] ?? [])];
    }
  }
  /** First alias present in the decoded args (case-insensitive), or undefined. */
  pick(args: Record<string, string | boolean>, field: LogicalField): string | undefined {
    const lower = new Map(Object.entries(args).map(([k, v]) => [k.toLowerCase(), v]));
    for (const a of this.aliases[field]) {
      const v = lower.get(a.toLowerCase());
      if (v !== undefined) return String(v);
    }
    return undefined;
  }
}
