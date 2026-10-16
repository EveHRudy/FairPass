# Person 5 integration notes

## Contract source of truth

- Contract source: `contracts/TicketNFT.sol` (deployed; do not edit for this task)
- ABI/deployment artifact: `deployments/sepolia.json`
- Sepolia chain ID: `11155111`
- Contract address: `0x6919957288D51D1b3A514AD2cbfF1Fb202418E5e`
- Deployment block: resolved from the artifact's deployment transaction receipt unless `START_BLOCK` is explicitly set.

Relevant actual read functions include `ownerOf(ticketId)`, `tokenURI(ticketId)`, `used(ticketId)`, `ticketEvent(ticketId)`, `events(eventId)`, `listings(ticketId)`, `maxResalePrice(ticketId)`, and `isVenue(eventId, venueAddress)`. Cap and royalty are stored per event in `events(eventId)`; do not replace them with global constants.

The `EventCreated` log includes name, date, face value, supply, cap percentage, and royalty percentage. The on-chain event struct does not store venue or image; those display fields are supplied via `/api/metadata` and kept in `event_details` SQLite table.

## Person 4 frontend integration

Configure the frontend API base to `http://localhost:4000/api` for local API development.

- Metadata: `POST /api/metadata`; send event details and an IPFS-compatible image URI. Pass the returned `uri` to `buyTicket(eventId, uri)` and pay exactly `faceValue`.
- Attendee QR: import `createCheckinQr` and `renderQrDataUrl` from `frontend-integration/src/lib/fairpassCheckin.ts`. The helper calls the challenge endpoint, verifies the server's exact message, asks the connected holder wallet to sign it, and returns a QR payload plus expiration time.
- Scanner: render `VenueScanner` with `apiBase`, `contractAddress`, and `chainId` (for example: `<VenueScanner apiBase={import.meta.env.VITE_API_URL} contractAddress={import.meta.env.VITE_CONTRACT_ADDRESS} chainId={Number(import.meta.env.VITE_CHAIN_ID ?? 11155111)} />`). The backend uses the configured server signer to submit `checkIn`; the connected scanner wallet is only used to establish the operator session/network in the UI, not to sign the check-in transaction.
- API responses contain ETH display strings as well as wei strings. Keep wei values as strings/bigints.

## Venue check-in configuration

Set `VENUE_PRIVATE_KEY` only in the local backend `.env` (never in Git, the frontend, or a response). It must belong either to the event organizer or to a venue address authorized for that specific event. The organizer must call `addVenue(eventId, venueAddress)` from their own wallet first. The connected scanner operator signs a fresh, time-limited confirmation message; the backend verifies that operator against the event organizer/`isVenue` check, then independently checks that its configured transaction signer is also organizer/authorized venue before submitting `checkIn(ticketId)` and waiting for the transaction receipt.

If the venue isn't authorized, the API returns `VENUE_NOT_AUTHORIZED` (server transaction signer) or `OPERATOR_NOT_AUTHORIZED` (connected scanner wallet); the organizer must register the scanner address. Do not solve authorization problems by changing the deployed contract.

## Security properties

- QR challenges use a random nonce, challenge UUID, event/ticket binding, holder, chain, contract, and 30-second expiry.
- Backend and integration helper use one message-building implementation in `src/shared/checkinMessage.ts`.
- Verify checks actual current owner, event association, and `used(ticketId)` on-chain. If those reads fail, entry fails closed.
- A challenge is consumed atomically and sibling pending challenges for that ticket are invalidated.
- Confirmation requires a signed operator authorization message; CORS alone is not treated as authentication.
- Confirmation uses a database state lock and records the confirmed transaction hash/block only after a successful receipt.
- Server secrets never belong in the repository or client bundle.
