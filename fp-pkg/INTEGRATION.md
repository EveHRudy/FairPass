# Integration contract (Person 5 ↔ everyone)

Everything below is what the backend **assumes** until the real artifacts are checked in. Anything that differs is a
config change (`.env`, `EVENT_ARG_MAP_JSON`, `FN_*`), not a code rewrite.

## From Persons 1 & 2 (contracts)
- Commit the compiled ABI (e.g. `artifacts/.../FairPass.json`) and tell me: **deployed address, network, deployment block**.
- Events the indexer reads, with the args it looks for (names matched case-insensitively; aliases in `src/indexer/argMap.ts`):
  - `EventCreated` → `eventId`, `organizer`, `name`, `venue`, `date`, `price`/`faceValue`, `maxSupply`
  - `TicketMinted` → `tokenId`, `eventId`, `to`/`owner`  (+ optional token URI)
  - `Listed` → `tokenId`, `seller`, `price`   · `Sold` → `tokenId`, `buyer`, `price` (+ `seller`)   · `CheckedIn` → `tokenId`
  - Optional: `ListingCancelled`/`Cancelled`/`Delisted`. If an event or arg is named differently, say so and I'll map it. Events missing from the ABI are skipped with a startup warning.
- Views the API calls: `ownerOf(uint256)` (must revert for non-existent tokens, as OZ v5 does); a **public check-in status getter** (`isCheckedIn(uint256)`, `checkedIn`, `isUsed`, ... auto-detected or set `FN_CHECKED_IN`; without one, "already used" falls back to the index); the **resale cap** and **royalty** as no-arg getters (`FN_CAP_PERCENT`, `FN_ROYALTY`), otherwise `FALLBACK_*` env values are used and flagged `config-fallback` in responses. If the cap is per-event, tell me; the current code reads one global value.
- **Token URI contract (Person 1):** what does `buyTicket` do with metadata? Options: (a) takes a full `tokenURI` string → use `uri` from `POST /metadata` (`TOKEN_URI_FORMAT=ipfs` → `ipfs://<cid>`); (b) takes only a CID/path with a base URI → use `cid`. I will not change the interface; confirm which.
- `checkIn(ticketId)` must be restricted to the venue/organizer role and revert if already used; the scanner calls exactly `checkIn(uint256 ticketId)`.
- If listed NFTs are held in escrow by the contract, set `LISTING_ESCROW=true`.

## For Person 4 (frontend)
- Base URL `VITE_API_URL`; add the frontend origin to `CORS_ORIGINS`.
- Attendee QR: `import { createCheckinQr, renderQrDataUrl } from '.../fairpassCheckin'` then
  `const qr = await createCheckinQr({ apiBase, ticketId, signer })` (`signer = await new BrowserProvider(window.ethereum).getSigner()`); show `await renderQrDataUrl(qr.payload)`; regenerate when `qr.expiresAt` passes (30 s).
- Scanner: mount `<VenueScanner apiBase contractAddress chainId abi />` on its own route (e.g. `/venue/scan`); needs `npm i html5-qrcode qrcode`. Pass the real contract ABI via `abi`.
- Money fields are wei strings (`...Wei`) plus ETH strings (`...Eth`); never parse them as JS numbers. `status` is `valid | listed | used`; the listings endpoint also returns `withinCap`, `capPercent`, `royaltyWei`.
- `POST /metadata` before minting; send only the returned `uri`/`cid` to the contract.

## For Person 3 (security testing)
Scenarios already covered by tests: replay, simultaneous scans, expired/malformed/foreign signatures, QR transferred to another ticket, ownership change after QR creation, RPC outage mid-verify. Worth probing further: reverse-proxy `trust proxy` + rate-limit keys, `/metadata` abuse (it spends Pinata quota; add an API key if exposed publicly), unauthenticated challenge issuance (needs a valid `ticketId` + current owner address, both public on-chain, so it can only create unusable challenges).

## Still needed to go live
`RPC_URL`, `CONTRACT_ADDRESS`, real ABI file, `START_BLOCK`, `PINATA_JWT` (+ gateway), the token-URI decision above, and the venue wallet address that holds the check-in role.
