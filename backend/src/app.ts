import cors from 'cors';
import express, { type Express, Router } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { z } from 'zod';
import type { AppConfig } from './config.js';
import type { DB } from './db/database.js';
import { getState } from './db/database.js';
import type { ChainReader } from './chain/ChainReader.js';
import { MetadataInputSchema, MetadataService } from './services/metadataService.js';
import { CheckinService } from './services/checkinService.js';
import { QueryServices } from './services/queryServices.js';
import { asyncHandler, errorHandler, limiter, notFound, validateBody } from './middleware/common.js';

export interface AppDeps {
  config: AppConfig;
  db: DB;
  chain: ChainReader;
  metadata?: MetadataService;
  checkin?: CheckinService;
  silent?: boolean;
  indexerStatus?: () => { lastError?: string };
}

const uint = z.string().regex(/^\d{1,78}$/, 'must be an unsigned integer string');
const ticketId = z.union([uint, z.number().int().nonnegative().transform(String)]);
const ChallengeBody = z.object({ ticketId, holder: z.string().min(40).max(42) });
const VerifyBody = z.object({
  v: z.literal(1), challengeId: z.string().uuid(), ticketId,
  eventId: uint.optional(), signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/, 'signature must be a 65-byte hex string'),
});
const ConfirmBody = z.object({
  challengeId: z.string().uuid(), ticketId, operatorAddress: z.string().min(40).max(42),
  operatorSignature: z.string().regex(/^0x[0-9a-fA-F]{130}$/, 'signature must be a 65-byte hex string'),
  signedAt: z.number().int().positive(),
});
const Paging = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) });

export function createApp(deps: AppDeps): Express {
  const { config, db, chain } = deps;
  const metadata = deps.metadata ?? new MetadataService(config, db);
  const checkin = deps.checkin ?? new CheckinService(db, chain, config);
  const queries = new QueryServices(db, chain, config, metadata);
  const app = express();
  const api = Router();

  app.disable('x-powered-by');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ origin: config.corsOrigins, methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization', 'X-Checkin-Api-Key'] }));
  app.use(express.json({ limit: '30kb' }));
  if (!deps.silent) app.use(morgan(config.nodeEnv === 'production' ? 'combined' : 'dev'));
  app.use(limiter(300));

  api.get('/health', asyncHandler(async (_req, res) => {
    let head: number | null = null; let chainOk = true;
    try { head = await chain.blockNumber(); } catch { chainOk = false; }
    const last = getState(db, 'last_processed_block');
    res.status(chainOk ? 200 : 503).json({
      status: chainOk ? 'ok' : 'degraded', chainId: config.chainId, contract: chain.contractAddress,
      chainHead: head, indexedUpToBlock: last === undefined ? null : Number(last), indexerError: deps.indexerStatus?.().lastError ?? null,
    });
  }));

  api.get('/events', asyncHandler(async (req, res) => {
    const { page, pageSize } = Paging.parse(req.query);
    res.json(await queries.listEvents(page, pageSize));
  }));
  api.get('/events/:id', asyncHandler(async (req, res) => res.json(await queries.getEvent(uint.parse(req.params.id)))));
  api.get('/listings', asyncHandler(async (req, res) => {
    const { page, pageSize } = Paging.parse(req.query);
    res.json(await queries.activeListings(page, pageSize));
  }));
  api.get('/tickets/:address', asyncHandler(async (req, res) => res.json(await queries.ticketsOf(req.params.address))));

  api.post('/metadata', limiter(20), validateBody(MetadataInputSchema), asyncHandler(async (req, res) => {
    res.status(201).json(await metadata.upload(req.body));
  }));
  api.get('/local-metadata/:cid', asyncHandler(async (req, res) => {
    if (!/^local-[0-9a-f-]{36}$/i.test(req.params.cid)) return res.status(404).json({ error: { code: 'METADATA_NOT_FOUND', message: 'Local metadata not found' } });
    const doc = metadata.localMetadata(req.params.cid);
    if (!doc) return res.status(404).json({ error: { code: 'METADATA_NOT_FOUND', message: 'Local metadata not found' } });
    res.setHeader('Cache-Control', 'no-store');
    res.json(doc);
  }));

  api.post('/checkin/challenge', limiter(30), validateBody(ChallengeBody), asyncHandler(async (req, res) => {
    res.status(201).json(await checkin.createChallenge(req.body));
  }));
  api.post('/checkin/verify', limiter(120), validateBody(VerifyBody), asyncHandler(async (req, res) => {
    const r = await checkin.verify(req.body);
    const { httpStatus, ...body } = r;
    res.status(httpStatus).json(body);
  }));
  api.post('/checkin/confirm', limiter(20), validateBody(ConfirmBody), asyncHandler(async (req, res) => {
    res.status(200).json(await checkin.confirm(req.body));
  }));
  api.get('/checkin/status/:ticketId', asyncHandler(async (req, res) => res.json(await checkin.status(uint.parse(req.params.ticketId)))));

  // Canonical /api routes for the frontend and legacy aliases retained for the existing demo/tests.
  app.use('/api', api);
  app.use('/', api);
  app.use(notFound);
  app.use(errorHandler());
  return app;
}
