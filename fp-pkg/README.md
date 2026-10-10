# FairPass Backend (Person 5)

Express + TypeScript + ethers v6 + SQLite service for **Event Ticketing with Anti-Scalping**: IPFS metadata,
a restart-safe blockchain indexer, the REST API, and signed-QR entry verification. Tickets are ERC-721 NFTs; the
chain is always the source of truth for ownership and validity, the SQLite index only speeds up queries.

```
npm install
cp .env.example .env      # fill RPC_URL, CONTRACT_ADDRESS, CONTRACT_ABI_PATH, START_BLOCK, PINATA_JWT
npm run dev               # API (+ indexer if INDEXER_ENABLED=true)
npm run indexer           # indexer only   (-- --once to catch up and exit, -- --reset to re-scan)
npm test                  # unit + API tests (no network needed)
npm run test:chain        # same reader/indexer against a local Hardhat node (real EVM)
npm run demo              # prints a full end-to-end walkthrough using an in-memory chain
npm run build && npm start
```

## Layout
```
src/config.ts            env parsing (zod)            src/chain/*         ChainReader interface + ethers implementation
src/db/database.ts       schema + checkpoints          src/indexer/*       Indexer, projector, event-argument aliases
src/services/*           metadata, check-in, queries   src/app.ts          routes, validation, rate limits, CORS, errors
src/scripts/*            indexer CLI, demo             frontend-integration/  QR helper + VenueScanner.tsx for Person 4
```

## Configuration
See `.env.example` (every variable documented). Secrets (`PINATA_JWT`, RPC key) live only in the backend `.env`
(git-ignored). **No private key is needed anywhere**: the backend never sends transactions.

The backend does not hard-code the contract interface. It reads `CONTRACT_ABI_PATH` (Hardhat artifact or bare ABI),
decodes logs with it, and maps event argument names through an alias table (`src/indexer/argMap.ts`, extend with
`EVENT_ARG_MAP_JSON`). Getter names (`ownerOf`, check-in status, resale cap, royalty) are auto-detected from the ABI
or set with `FN_*`. `abi/FairPass.abi.example.json` is a **placeholder shaped like the spec**, replace it with the real ABI.

## REST API
| Method & path | Purpose |
|---|---|
| `GET /health` | status, chain head, indexed block |
| `GET /events?page&pageSize` · `GET /events/:id` | indexed events, supply left; detail adds tickets + metadata (404 if unknown) |
| `GET /listings` | active resale listings, verified on-chain (owner, not checked in), with cap/royalty |
| `GET /tickets/:address` | wallet's tickets; ownership re-checked on-chain; status `valid` / `listed` / `used` |
| `POST /metadata` | validate, build NFT JSON, pin to IPFS via Pinata |
| `POST /checkin/challenge` | 30 s signed-message challenge for a ticket the wallet owns |
| `POST /checkin/verify` | verify QR signature, owner, status; atomically consume challenge |
| `GET /checkin/status/:ticketId` | authoritative owner / checked-in read (used after the venue tx) |

Errors are `{ "error": { "code", "message" } }`; verification results are `{ "valid", "code", "message", ... }`.

### `POST /metadata`
```jsonc
// request
{ "eventName": "Neon Nights", "date": "2027-01-15T19:00:00Z", "venue": "Hall A", "tier": "VIP", "seat": "A-12",
  "description": "Doors 18:00", "image": "ipfs://bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy", "eventId": 1 }
// 201 response
{ "cid": "bafkrei...", "uri": "ipfs://bafkrei...", "ipfsUri": "ipfs://bafkrei...",
  "gatewayUrl": "https://gateway.pinata.cloud/ipfs/bafkrei...",
  "metadata": { "name": "Neon Nights — VIP · A-12", "description": "Doors 18:00", "image": "ipfs://...",
    "attributes": [ { "trait_type": "Event", "value": "Neon Nights" }, { "trait_type": "Date", "value": "2027-01-15T19:00:00.000Z" },
                    { "trait_type": "Venue", "value": "Hall A" }, { "trait_type": "Tier", "value": "VIP" }, { "trait_type": "Seat", "value": "A-12" },
                    { "trait_type": "Event ID", "value": "1" } ] } }
```
`uri` follows `TOKEN_URI_FORMAT` (`ipfs` → `ipfs://<cid>`, `gateway` → full gateway URL). If `buyTicket` concatenates a
base URI, pass `cid` instead. Failures are never faked: 503 not configured, 502 Pinata rejected/bad reply, 504 unreachable.

### Check-in flow (non-custodial)
1. Attendee app → `POST /checkin/challenge {ticketId, holder}` → exact message to sign (EIP-191, 30 s TTL, binds ticket, holder, chain, contract, 32-byte nonce).
2. Wallet signs; app renders QR `FP1:` + base64url(`{v:1, challengeId, ticketId, signature}`) (`frontend-integration/src/lib/fairpassCheckin.ts`).
3. Venue scanner → `POST /checkin/verify`. Backend loads the stored message by `challengeId` (never rebuilt from client data), recovers the signer, compares with **on-chain** `ownerOf`, checks the **on-chain** used flag, then consumes the challenge with a single conditional `UPDATE` (only one concurrent request can win) and voids sibling QR codes for that ticket.
4. On `valid: true` the **authorized venue wallet** sends `checkIn(ticketId)`; the scanner waits for the receipt and re-reads status from the chain. `valid: true` alone never means "checked in".

Design notes: a bad signature does *not* consume a challenge (otherwise anyone who sees a QR could burn it); an RPC outage returns 503 and leaves the challenge usable; if the venue transaction fails the QR is spent and the attendee refreshes it.

## Indexer
Polling log scanner with checkpoints (no reliance on WebSockets): starts at `START_BLOCK`, scans in batches (auto-shrinks if the RPC rejects wide ranges), lags the head by `INDEXER_CONFIRMATIONS`, retries transient errors with backoff, stores raw logs with `UNIQUE(tx_hash, log_index)` (idempotent), advances the checkpoint in the same SQLite transaction, and records batch-end block hashes. If the stored hash no longer matches the chain it rolls back to the last common block and rebuilds the derived tables from the raw log. Tables: `chain_events`, `events`, `tickets`, `listings`, `checkin_challenges`, `indexer_state`, `block_hashes`, `metadata_cache`.

Optional events `ListingCancelled` / `Cancelled` / `Delisted` close listings if the ABI declares them.

## Testing status
`npm test`: 41 tests (check-in replay/expiry/concurrency/ownership, indexer restart/reorg/retry/batching, every endpoint, Pinata success/failure paths, frontend helper ↔ backend). `npm run test:chain` runs the real `EthersChainReader` and indexer on Hardhat against `test/fixtures/MockTicketing.sol` (a *test stand-in*, not the project contract). Not verified here: live Pinata calls, Sepolia, the real contract, the React page in a browser with MetaMask/camera.
