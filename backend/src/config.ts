import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAddress } from 'ethers';
import { z } from 'zod';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
export const BACKEND_ROOT = path.resolve(moduleDir, '..');
export const PROJECT_ROOT = path.resolve(BACKEND_ROOT, '..');
const bool = (v: string | undefined, d: boolean) => (v === undefined || v === '' ? d : v.toLowerCase() === 'true');
const optStr = (v: string | undefined) => (v && v.trim() !== '' ? v.trim() : undefined);
const optNum = (v: string | undefined) => (v && v.trim() !== '' ? Number(v) : undefined);

function firstExisting(candidates: string[]): string {
  for (const candidate of candidates) if (fs.existsSync(candidate)) return path.resolve(candidate);
  return path.resolve(candidates[0]);
}

export function resolveProjectPath(p: string): string {
  if (path.isAbsolute(p)) return p;
  return firstExisting([
    path.resolve(process.cwd(), p),
    path.resolve(PROJECT_ROOT, p),
    path.resolve(BACKEND_ROOT, p),
  ]);
}

function findDeploymentPath(env: NodeJS.ProcessEnv): string {
  const requested = optStr(env.DEPLOYMENT_PATH);
  if (requested) return resolveProjectPath(requested);
  return firstExisting([
    path.join(PROJECT_ROOT, 'deployments', 'sepolia.json'),
    path.join(BACKEND_ROOT, 'deployments', 'sepolia.json'),
  ]);
}

function readDeployment(file: string): { address?: string; chainId?: number; txHash?: string; abi?: unknown[] } {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    return {
      address: typeof value.address === 'string' ? value.address : undefined,
      chainId: typeof value.chainId === 'number' ? value.chainId : undefined,
      txHash: typeof value.txHash === 'string' ? value.txHash : undefined,
      abi: Array.isArray(value.abi) ? value.abi : undefined,
    };
  } catch {
    return {};
  }
}

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  NODE_ENV: z.string().default('development'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  DATABASE_PATH: z.string().default('./data/fairpass.sqlite'),
  RPC_URL: z.string().default(''),
  CHAIN_ID: z.coerce.number().int().positive().optional(),
  CONTRACT_ADDRESS: z.string().default(''),
  CONTRACT_ABI_PATH: z.string().default(''),
  START_BLOCK: z.coerce.number().int().nonnegative().optional(),
  INDEXER_POLL_MS: z.coerce.number().int().positive().default(6000),
  INDEXER_BATCH_SIZE: z.coerce.number().int().positive().default(2000),
  INDEXER_CONFIRMATIONS: z.coerce.number().int().nonnegative().default(2),
  INDEXER_MAX_REORG_DEPTH: z.coerce.number().int().positive().default(64),
  CHALLENGE_TTL_SECONDS: z.coerce.number().int().positive().max(300).default(30),
  PINATA_JWT: z.string().optional(),
  PINATA_GATEWAY_URL: z.string().url().default('https://gateway.pinata.cloud'),
  TOKEN_URI_FORMAT: z.enum(['ipfs', 'gateway']).default('ipfs'),
  VENUE_PRIVATE_KEY: z.string().optional(),
  METADATA_LOCAL_MODE: z.string().optional(),
  LOCAL_METADATA_BASE_URL: z.string().url().optional(),
  INDEXER_ENABLED: z.string().optional(),
  EVENT_ARG_MAP_JSON: z.string().optional(),
  LISTING_ESCROW: z.string().optional(),
  FALLBACK_CAP_PERCENT: z.coerce.number().min(0).max(100).optional(),
  FALLBACK_ROYALTY_PERCENT: z.coerce.number().min(0).max(50).optional(),
  FN_OWNER_OF: z.string().optional(),
  FN_CHECKED_IN: z.string().optional(),
  FN_CAP_PERCENT: z.string().optional(),
  FN_ROYALTY: z.string().optional(),
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
  deploymentPath: string;
  deploymentTxHash?: string;
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
  venuePrivateKey?: string;
  metadataLocalMode: boolean;
  localMetadataBaseUrl: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const e = EnvSchema.parse(env);
  const deploymentPath = findDeploymentPath(env);
  const deployment = readDeployment(deploymentPath);
  const contractAddress = optStr(e.CONTRACT_ADDRESS) ?? deployment.address ?? '';
  if (contractAddress && !isAddress(contractAddress)) throw new Error('CONTRACT_ADDRESS is not a valid Ethereum address');
  const chainId = e.CHAIN_ID ?? deployment.chainId ?? 11155111;
  const contractAbiPath = optStr(e.CONTRACT_ABI_PATH)
    ? resolveProjectPath(e.CONTRACT_ABI_PATH)
    : deploymentPath;
  const databasePath = e.DATABASE_PATH === ':memory:' ? ':memory:' : resolveProjectPath(e.DATABASE_PATH);
  const rawStartBlock = env.START_BLOCK?.trim();
  const startBlock = rawStartBlock ? Number(rawStartBlock) : 0;
  if (!Number.isSafeInteger(startBlock) || startBlock < 0) throw new Error('START_BLOCK must be a non-negative integer');
  return {
    port: e.PORT,
    nodeEnv: e.NODE_ENV,
    corsOrigins: e.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    databasePath,
    rpcUrl: e.RPC_URL.trim(),
    chainId,
    contractAddress,
    contractAbiPath,
    deploymentPath,
    deploymentTxHash: deployment.txHash,
    startBlock,
    indexer: {
      enabled: bool(e.INDEXER_ENABLED, true),
      pollMs: e.INDEXER_POLL_MS,
      batchSize: e.INDEXER_BATCH_SIZE,
      confirmations: e.INDEXER_CONFIRMATIONS,
      maxReorgDepth: e.INDEXER_MAX_REORG_DEPTH,
    },
    fn: {
      ownerOf: optStr(e.FN_OWNER_OF) ?? 'ownerOf',
      checkedIn: optStr(e.FN_CHECKED_IN),
      capPercent: optStr(e.FN_CAP_PERCENT),
      royalty: optStr(e.FN_ROYALTY),
    },
    fallbackCapPercent: e.FALLBACK_CAP_PERCENT,
    fallbackRoyaltyPercent: e.FALLBACK_ROYALTY_PERCENT,
    eventArgMapJson: optStr(e.EVENT_ARG_MAP_JSON),
    listingEscrow: bool(e.LISTING_ESCROW, false),
    pinataJwt: optStr(e.PINATA_JWT),
    pinataGatewayUrl: e.PINATA_GATEWAY_URL.replace(/\/+$/, ''),
    tokenUriFormat: e.TOKEN_URI_FORMAT,
    challengeTtlSeconds: e.CHALLENGE_TTL_SECONDS,
    venuePrivateKey: optStr(e.VENUE_PRIVATE_KEY),
    metadataLocalMode: bool(e.METADATA_LOCAL_MODE, false),
    localMetadataBaseUrl: (optStr(e.LOCAL_METADATA_BASE_URL) ?? `http://localhost:${e.PORT}`).replace(/\/+$/, ''),
  };
}
