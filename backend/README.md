# FairPass Backend (Person 5)

Express + TypeScript API, Sepolia event indexer, Pinata metadata uploader, and signed QR entry verification for the FairPass NFT ticketing project.

## Deployed contract

- Network: Sepolia (`chainId=11155111`)
- Address: `0x6919957288D51D1b3A514AD2cbfF1Fb202418E5e`
- Etherscan: https://sepolia.etherscan.io/address/0x6919957288D51D1b3A514AD2cbfFf1Fb202418E5e#code
- Canonical artifact: `../deployments/sepolia.json`

The backend reads the ABI, address, chain ID, and deployment transaction hash from `deployments/sepolia.json` by default. It resolves the deployment block from the transaction receipt unless `START_BLOCK` is explicitly supplied. The deployed contract is authoritative for ownership, ticket-used state, per-event cap and royalty, listings, and venue authorization.

**Do not edit `../contracts/TicketNFT.sol` as part of backend work.** It is already deployed and verified.

## Install and run

Run commands from this directory (`backend/`):

```powershell
npm ci
Copy-Item .env.example .env
# Set RPC_URL and PINATA_JWT in .env before using live Sepolia features.
npm run typecheck
npm test
npm run build
npm run demo
npm start
# Production-style start after build: npm run start:prod
```

The API listens on `http://localhost:4000` by default. `npm start` launches the TypeScript server with `tsx`; after `npm run build`, `npm run start:prod` launches the compiled JavaScript server. With the server running, open `http://localhost:4000/health`. The same API routes are available with the frontend-required `/api` prefix, e.g. `GET /api/events`.

Run the indexer separately with `npm run indexer`; add `-- --once` to process one catch-up pass and exit. `npm run test:chain` runs the local EVM integration test if the local Hardhat tooling is available.

The project source is offline-testable. A live Sepolia session requires an RPC URL; IPFS uploads require a Pinata JWT; on-chain check-in confirmation requires the private key of a test organizer or event-authorized venue wallet. **Never use a wallet holding real funds.**

## Environment variables

See `.env.example`. Important variables:

| Variable | Purpose |
|---|---|
| `RPC_URL` | Sepolia or local Hardhat JSON-RPC endpoint |
| `CHAIN_ID` | `11155111` for Sepolia; `31337` for local Hardhat |
| `DEPLOYMENT_PATH` | Defaults to `../deployments/sepolia.json` |
| `CONTRACT_ADDRESS` | Defaults to the address in the deployment JSON |
| `CONTRACT_ABI_PATH` | Optional ABI path override; defaults to the deployment JSON |
| `START_BLOCK` | Explicit indexer start block; `0` resolves the deployment transaction block |
| `DATABASE_PATH` | SQLite database file; defaults to `./data/fairpass.sqlite` relative to the backend working directory |
| `PINATA_JWT` | Server-only credential for real IPFS metadata uploads |
| `PINATA_GATEWAY_URL` | Public IPFS gateway used for display URLs |
| `METADATA_LOCAL_MODE` | Local metadata fallback; permitted only on a non-Sepolia local chain |
| `LOCAL_METADATA_BASE_URL` | Public base URL for local metadata when running the local demo |
| `VENUE_PRIVATE_KEY` | Server-only key for an organizer/authorized venue test wallet to submit `checkIn` |
| `CORS_ORIGINS` | Comma-separated allowed frontend origins |
| `INDEXER_ENABLED` | Start the indexer alongside the API server |

`VENUE_PRIVATE_KEY` is never sent to the browser and must not be committed. The signer must be the event organizer or be added by the organizer with `addVenue(eventId, address)` for the relevant event.

## API summary

All routes are available at both their canonical `/api/...` prefix and legacy root aliases. Frontends should use `/api`.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | API status, chain head, indexed checkpoint |
| `GET` | `/api/events` | Paginated indexed event list with on-chain supply/sold/cap/royalty where readable |
| `GET` | `/api/events/:id` | Event details, ticket statuses, and best-effort metadata |
| `GET` | `/api/listings` | Active listings revalidated against on-chain owner, price, event, max price, and used state |
| `GET` | `/api/tickets/:address` | Current tickets of a wallet, checking current ownership on-chain |
| `POST` | `/api/metadata` | Pinata metadata upload; local fallback only for local Hardhat development |
| `GET` | `/api/local-metadata/:cid` | Serve locally stored metadata in explicit local mode |
| `POST` | `/api/checkin/challenge` | Create a 30-second holder-bound challenge |
| `POST` | `/api/checkin/verify` | Verify signed QR, owner, event, and unused state; consume challenge atomically |
| `POST` | `/api/checkin/confirm` | Submit `checkIn(ticketId)` from configured organizer/venue key and wait for confirmation |
| `GET` | `/api/checkin/status/:ticketId` | Current on-chain owner and used state |

Errors use `{ "error": { "code": "...", "message": "..." } }`. The QR verification endpoint uses `{ "valid", "code", "message", ... }` for valid and invalid outcomes.

## Metadata request example

```json
{
  "eventId": "1",
  "eventName": "Neon Nights",
  "description": "Entry ticket for Neon Nights",
  "date": "2027-01-15T19:00:00Z",
  "venue": "Hall A",
  "tier": "VIP",
  "seat": "A-12",
  "image": "ipfs://<image-cid>"
}
```

A successful Pinata response contains the actual `cid`, `uri` (normally `ipfs://<metadata-cid>`), `ipfsUri`, gateway URL, and metadata JSON. Person 4's frontend passes the returned URI to `buyTicket(eventId, uri)` and sends exactly `faceValue` wei. Never pass a local metadata URL to a Sepolia purchase. If local mode is used with chain ID `31337`, the response is explicitly marked `local: true` and warns that the URI is for demos only.

## QR check-in flow

1. The holder calls `POST /api/checkin/challenge` with `{ "ticketId": "1", "holder": "0x..." }`.
2. The backend reads owner, `ticketEvent(ticketId)`, `events(eventId)`, and `used(ticketId)` on-chain, then persists a nonce and a 30-second expiry.
3. The holder signs the exact returned message through MetaMask. The shared implementation lives in `src/shared/checkinMessage.ts`; the helper is under `frontend-integration/src/lib/fairpassCheckin.ts`.
4. The scanner sends the versioned QR payload to `POST /api/checkin/verify`. The backend recovers the signer and re-checks current owner, event binding, and `used(ticketId)`. RPC failures fail closed; database owner state is never used to approve entry.
5. After successful verification, the connected scanner operator signs a fresh confirmation message tied to the challenge, event, ticket, chain, contract, and timestamp. The scanner calls `POST /api/checkin/confirm` with that operator address/signature. The backend verifies that the operator is the organizer or is authorized by `isVenue(eventId, operatorAddress)`, independently confirms its configured transaction signer is organizer/authorized venue, submits `checkIn(ticketId)`, waits for a successful receipt, and returns the transaction hash and block number.
6. Subsequent QR attempts and fresh challenges for a used ticket are rejected.

Only use `VENUE_PRIVATE_KEY` for a dedicated Sepolia test account or local Hardhat account. For a venue wallet, the organizer must first call `addVenue(eventId, venueAddress)` from their wallet. No backend configuration can override contract authorization.

## Indexer behavior

The polling indexer reads only event names present in the deployment ABI, starts from the explicit or resolved deployment block, stores decoded logs in SQLite, checkpoints processed blocks, and makes re-processing idempotent. Projection state is rebuildable after detected reorg rollback. Event name/date/cap/royalty are read from `EventCreated` and/or the contract; venue and image display details are off-chain metadata because venue is not a field in the deployed event struct.

## Test notes

- `npm test`: offline Vitest, Supertest, fake-chain and frontend-helper tests.
- `npm run typecheck`: TypeScript no-emit validation.
- `npm run build`: backend TypeScript compilation.
- `npm run demo`: simulated end-to-end walkthrough, not proof of Sepolia transactions.
- `npm run test:chain`: a real local EVM test using a test-only mock contract, not the deployed Sepolia contract.

Live Sepolia reads/transactions and Pinata uploads must be tested separately with real configured credentials. Do not report a simulated run as a live-chain verification.
