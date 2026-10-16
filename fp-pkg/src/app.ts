import cors from 'cors';
import express, { type Express } from 'express';
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
const ChallengeBody = z.object({ ticketId: z.union([uint, z.number().int().nonnegative().transform(String)]), holder: z.string().min(40).max(42) });
const VerifyBody = z.object({
  v: z.literal(1),
  challengeId: z.string().uuid(),
  ticketId: z.union([uint, z.number().int().nonnegative().transform(String)]),
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/, 'signature must be a 65-byte hex string'),
});
const Paging = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) });

export function createApp(deps: AppDeps): Express {
  const { config, db, chain } = deps;
  const metadata = deps.metadata ?? new MetadataService(config, db);
  const checkin = deps.checkin ?? new CheckinService(db, chain, config);
  const queries = new QueryServices(db, chain, config, metadata);

  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } })); // API is consumed cross-origin by the Vite app
  app.use(cors({ origin: config.corsOrigins, methods: ['GET', 'POST'] }));
  app.use(express.json({ limit: '20kb' }));
  if (!deps.silent) app.use(morgan(config.nodeEnv === 'production' ? 'combined' : 'dev'));
  app.use(limiter(300));

  app.get('/health', asyncHandler(async (_req, res) => {
    let head: number | null = null;
    let chainOk = true;
    try { head = await chain.blockNumber(); } catch { chainOk = false; }
    const last = getState(db, 'last_processed_block');
    res.status(chainOk ? 200 : 503).json({
      status: chainOk ? 'ok' : 'degraded',
      chainId: config.chainId, contract: chain.contractAddress,
      chainHead: head, indexedUpToBlock: last === undefined ? null : Number(last),
      indexerError: deps.indexerStatus?.().lastError ?? null,
    });
  }));

  app.get('/events', asyncHandler(async (req, res) => {
    const { page, pageSize } = Paging.parse(req.query);
    res.json(queries.listEvents(page, pageSize));
  }));
  app.get('/events/:id', asyncHandler(async (req, res) => {
    res.json(await queries.getEvent(uint.parse(req.params.id)));
  }));
  app.get('/listings', asyncHandler(async (req, res) => {
    const { page, pageSize } = Paging.parse(req.query);
    res.json(await queries.activeListings(page, pageSize));
  }));
  app.get('/tickets/:address', asyncHandler(async (req, res) => {
    res.json(await queries.ticketsOf(req.params.address));
  }));

  app.post('/metadata', limiter(20), validateBody(MetadataInputSchema), asyncHandler(async (req, res) => {
    res.status(201).json(await metadata.upload(req.body));
  }));

  app.post('/checkin/challenge', limiter(30), validateBody(ChallengeBody), asyncHandler(async (req, res) => {
    res.status(201).json(await checkin.createChallenge(req.body));
  }));
  app.post('/checkin/verify', limiter(120), validateBody(VerifyBody), asyncHandler(async (req, res) => {
    const r = await checkin.verify(req.body);
    const { httpStatus, ...body } = r;
    res.status(httpStatus).json(body);
  }));
  app.get('/checkin/status/:ticketId', asyncHandler(async (req, res) => {
    res.json(await checkin.status(uint.parse(req.params.ticketId)));
  }));

  app.use(notFound);
  app.use(errorHandler());
  return app;
}
