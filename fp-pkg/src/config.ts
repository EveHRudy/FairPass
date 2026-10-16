import 'dotenv/config';
import { z } from 'zod';

const bool = (v: string | undefined, d: boolean) => (v === undefined || v === '' ? d : v.toLowerCase() === 'true');
const optStr = (v: string | undefined) => (v && v.trim() !== '' ? v.trim() : undefined);
const optNum = (v: string | undefined) => (v && v.trim() !== '' ? Number(v) : undefined);

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  NODE_ENV: z.string().default('development'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  DATABASE_PATH: z.string().default('./data/fairpass.sqlite'),
  RPC_URL: z.string().default(''),
  CHAIN_ID: z.coerce.number().int().positive().default(11155111),
  CONTRACT_ADDRESS: z.string().default(''),
  CONTRACT_ABI_PATH: z.string().default('./abi/FairPass.abi.json'),
  START_BLOCK: z.coerce.number().int().nonnegative().default(0),
  INDEXER_POLL_MS: z.coerce.number().int().positive().default(6000),
  INDEXER_BATCH_SIZE: z.coerce.number().int().positive().default(2000),
  INDEXER_CONFIRMATIONS: z.coerce.number().int().nonnegative().default(2),
  INDEXER_MAX_REORG_DEPTH: z.coerce.number().int().positive().default(64),
  CHALLENGE_TTL_SECONDS: z.coerce.number().int().positive().default(30),
  PINATA_GATEWAY_URL: z.string().default('https://gateway.pinata.cloud'),
  TOKEN_URI_FORMAT: z.enum(['ipfs', 'gateway']).default('ipfs'),
});

export interface AppConfig {
  port: number;
  nodeEnv: string;
  corsOrigins: string[];
  databasePath: string;
  rpcUrl: string;
  chainId: number;
  contractAddress: string;
  contractAbiPath: string;
  startBlock: number;
  indexer: { enabled: boolean; pollMs: number; batchSize: number; confirmations: number; maxReorgDepth: number };
  fn: { ownerOf: string; checkedIn?: string; capPercent?: string; royalty?: string };
  fallbackCapPercent?: number;
  fallbackRoyaltyPercent?: number;
  eventArgMapJson?: string;
  listingEscrow: boolean;
  pinataJwt?: string;
  pinataGatewayUrl: string;
  tokenUriFormat: 'ipfs' | 'gateway';
  challengeTtlSeconds: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const e = EnvSchema.parse(env);
  return {
    port: e.PORT,
    nodeEnv: e.NODE_ENV,
    corsOrigins: e.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    databasePath: e.DATABASE_PATH,
    rpcUrl: e.RPC_URL,
    chainId: e.CHAIN_ID,
    contractAddress: e.CONTRACT_ADDRESS,
    contractAbiPath: e.CONTRACT_ABI_PATH,
    startBlock: e.START_BLOCK,
    indexer: {
      enabled: bool(env.INDEXER_ENABLED, true),
      pollMs: e.INDEXER_POLL_MS,
      batchSize: e.INDEXER_BATCH_SIZE,
      confirmations: e.INDEXER_CONFIRMATIONS,
      maxReorgDepth: e.INDEXER_MAX_REORG_DEPTH,
    },
    fn: {
      ownerOf: optStr(env.FN_OWNER_OF) ?? 'ownerOf',
      checkedIn: optStr(env.FN_CHECKED_IN),
      capPercent: optStr(env.FN_CAP_PERCENT),
      royalty: optStr(env.FN_ROYALTY),
    },
    fallbackCapPercent: optNum(env.FALLBACK_CAP_PERCENT),
    fallbackRoyaltyPercent: optNum(env.FALLBACK_ROYALTY_PERCENT),
    eventArgMapJson: optStr(env.EVENT_ARG_MAP_JSON),
    listingEscrow: bool(env.LISTING_ESCROW, false),
    pinataJwt: optStr(env.PINATA_JWT),
    pinataGatewayUrl: e.PINATA_GATEWAY_URL.replace(/\/+$/, ''),
    tokenUriFormat: e.TOKEN_URI_FORMAT,
    challengeTtlSeconds: e.CHALLENGE_TTL_SECONDS,
  };
}
