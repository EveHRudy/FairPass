import { z } from 'zod';
import type { DB } from '../db/database.js';
import type { AppConfig } from '../config.js';
import { HttpError } from '../errors.js';

const IPFS_IMAGE = /^ipfs:\/\/[A-Za-z0-9]{46,100}(\/[\w.\-%/]*)?$/;
const imageRef = z.string().max(500).refine((v) => {
  if (IPFS_IMAGE.test(v)) return true;
  try { const u = new URL(v); return u.protocol === 'https:' && !!u.hostname; } catch { return false; }
}, 'image must be an ipfs://<CID>[/path] URI or an https:// URL');

export const MetadataInputSchema = z.object({
  eventName: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).optional(),
  date: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'date must be a valid ISO-8601 date/time'),
  venue: z.string().trim().min(1).max(200),
  seat: z.string().trim().min(1).max(60).optional(),
  tier: z.string().trim().min(1).max(60).optional(),
  eventId: z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]).optional(),
  image: imageRef.optional(),
  externalUrl: z.string().url().max(500).optional(),
  attributes: z.array(z.object({ trait_type: z.string().min(1).max(60), value: z.union([z.string().max(200), z.number()]) })).max(20).optional(),
}).refine((v) => v.seat || v.tier, { message: 'either seat or tier is required', path: ['seat'] });

export type MetadataInput = z.infer<typeof MetadataInputSchema>;

export interface NftMetadata {
  name: string; description: string; image?: string; external_url?: string;
  attributes: Array<{ trait_type: string; value: string | number }>;
}

export function buildMetadata(i: MetadataInput): NftMetadata {
  const iso = new Date(i.date).toISOString();
  const label = [i.tier, i.seat].filter(Boolean).join(' · ');
  const attributes: NftMetadata['attributes'] = [
    { trait_type: 'Event', value: i.eventName },
    { trait_type: 'Date', value: iso },
    { trait_type: 'Venue', value: i.venue },
  ];
  if (i.tier) attributes.push({ trait_type: 'Tier', value: i.tier });
  if (i.seat) attributes.push({ trait_type: 'Seat', value: i.seat });
  if (i.eventId !== undefined) attributes.push({ trait_type: 'Event ID', value: String(i.eventId) });
  for (const a of i.attributes ?? []) attributes.push(a);
  return {
    name: `${i.eventName} — ${label}`,
    description: i.description ?? `Ticket for ${i.eventName} at ${i.venue} on ${iso}.`,
    ...(i.image ? { image: i.image } : {}),
    ...(i.externalUrl ? { external_url: i.externalUrl } : {}),
    attributes,
  };
}

type FetchFn = typeof fetch;

export class MetadataService {
  constructor(private cfg: AppConfig, private db: DB, private fetchFn: FetchFn = fetch) {}

  uriFor(cid: string): string {
    return this.cfg.tokenUriFormat === 'gateway' ? `${this.cfg.pinataGatewayUrl}/ipfs/${cid}` : `ipfs://${cid}`;
  }
  gatewayUrl(cid: string): string { return `${this.cfg.pinataGatewayUrl}/ipfs/${cid}`; }

  /** Pins the metadata JSON on Pinata. Never fabricates a CID: any failure surfaces as an HTTP error. */
  async upload(input: MetadataInput) {
    if (!this.cfg.pinataJwt) throw new HttpError(503, 'IPFS uploads are not configured on this server (PINATA_JWT missing)', 'PINATA_NOT_CONFIGURED');
    const metadata = buildMetadata(input);
    let res: Response;
    try {
      res = await this.fetchFn('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.cfg.pinataJwt}` },
        body: JSON.stringify({ pinataContent: metadata, pinataMetadata: { name: `fairpass-${input.eventName}`.slice(0, 100) } }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new HttpError(504, 'Could not reach Pinata (network error or timeout)', 'PINATA_UNREACHABLE');
    }
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) throw new HttpError(502, 'Pinata rejected the server credentials', 'PINATA_AUTH_FAILED');
      if (res.status === 429) throw new HttpError(503, 'Pinata rate limit reached, retry shortly', 'PINATA_RATE_LIMITED');
      throw new HttpError(502, `Pinata upload failed with status ${res.status}`, 'PINATA_UPLOAD_FAILED');
    }
    const body = (await res.json().catch(() => null)) as { IpfsHash?: string } | null;
    const cid = body?.IpfsHash;
    if (typeof cid !== 'string' || !/^[A-Za-z0-9]{46,100}$/.test(cid)) {
      throw new HttpError(502, 'Pinata returned an unexpected response', 'PINATA_BAD_RESPONSE');
    }
    return { cid, uri: this.uriFor(cid), ipfsUri: `ipfs://${cid}`, gatewayUrl: this.gatewayUrl(cid), metadata };
  }

  private toHttp(uri: string): string | null {
    if (uri.startsWith('ipfs://')) return `${this.cfg.pinataGatewayUrl}/ipfs/${uri.slice(7).replace(/^ipfs\//, '')}`;
    if (uri.startsWith('https://')) return uri;
    return null;
  }

  /** Reads token metadata (cached in SQLite). Returns null on any failure - metadata is best-effort for display. */
  async resolve(uri: string | null | undefined): Promise<unknown | null> {
    if (!uri) return null;
    const cached = this.db.prepare('SELECT json FROM metadata_cache WHERE uri=?').get(uri) as { json: string } | undefined;
    if (cached) return JSON.parse(cached.json);
    const url = this.toHttp(uri);
    if (!url) return null;
    try {
      const res = await this.fetchFn(url, { signal: AbortSignal.timeout(4000), headers: { Accept: 'application/json' } });
      if (!res.ok) return null;
      const text = await res.text();
      if (text.length > 256_000) return null;
      const json = JSON.parse(text);
      this.db.prepare('INSERT OR REPLACE INTO metadata_cache (uri, json, fetched_at) VALUES (?,?,?)').run(uri, JSON.stringify(json), Date.now());
      return json;
    } catch { return null; }
  }
  cachedOnly(uri: string | null | undefined): unknown | null {
    if (!uri) return null;
    const c = this.db.prepare('SELECT json FROM metadata_cache WHERE uri=?').get(uri) as { json: string } | undefined;
    return c ? JSON.parse(c.json) : null;
  }
}
