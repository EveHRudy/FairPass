# Stubline frontend (Person 4)

React + Vite + TypeScript + Tailwind + ethers.js v6.

## Run it

```bash
npm install
cp .env.example .env     # already copied for you; edit as needed
npm run dev              # http://localhost:5173
```

## Two modes

| Mode | `.env` | What happens |
|------|--------|--------------|
| Mock (default) | `VITE_USE_MOCK=true` | Whole app runs on sample data in `src/lib/mock.ts`. No contract, backend or MetaMask needed. |
| Real | `VITE_USE_MOCK=false` | Reads come from Person 5's API, transactions go to the Sepolia contract. |

### Switching to the real contract

1. **Person 1** gives you the deployed address and ABI.
   - Put the address in `.env` as `VITE_CONTRACT_ADDRESS`.
   - Save the exported ABI as `src/lib/abi/TicketNFT.json` and swap it into `src/lib/contract.ts` (see the comment above `TICKET_ABI`).
2. **Person 5** gives you the backend URL and API list. Put the URL in `.env` as `VITE_API_URL`.
3. Set `VITE_USE_MOCK=false`, restart `npm run dev`.

Every place that depends on another person is marked with a comment starting
`INTEGRATION (Person N)`. Find them all with:

```bash
grep -rn "INTEGRATION" src .env.example
```

## Folder map

```
src/
  main.tsx, App.tsx          app entry and routes
  types.ts                   EventInfo, Ticket, Listing (match the shared struct)
  lib/
    contract.ts              deployed address + ABI  (the "lib/contract.ts" deliverable)
    chain.ts                 every transaction + on-chain reads
    api.ts                   backend endpoints (events, listings, tickets, challenge)
    qr.ts                    signs the check-in challenge and builds the QR payload
    mock.ts                  fake chain and backend for mock mode
    format.ts                ETH/date formatting, resale cap math, readable revert messages
    config.ts                env values and shared constants (24h resale lock)
  context/                   wallet, toasts, global refresh after transactions
  hooks/useAsync.ts          data loading with loading and error state
  components/                Layout, Stub (ticket card), modals, shared UI
  pages/                     Home, EventDetails, MyTickets, Marketplace, Organizer
docs/USER_FLOW.md            walkthrough for the report
```

## Pages (from the work split)

- **Home**: events with date, price, tickets remaining.
- **Event details**: buy button with loading, success and readable error states.
- **My tickets**: status (valid, listed, used), list for resale, cancel listing, entry QR.
- **List for resale modal**: reads `capPercent` from the contract, shows the maximum price, blocks anything above it.
- **Marketplace**: active listings with price, face value and royalty.
- **Organizer dashboard**: create event, sales and royalties, withdraw, venue scanners.

Wallet connection, wrong-network prompt (with a Switch to Sepolia button), responsive layout and error handling are built in.
