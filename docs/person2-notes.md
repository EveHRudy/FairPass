# Person 2 Implementation Notes: Secondary Market & Resale Controls

## Transfer lock
Direct peer-to-peer transfers are strictly blocked to prevent ticket scalping and off-platform secondary transactions that bypass price caps, resale limits, and royalties. All secondary transfers must execute through the official smart contract marketplace (`buyResale`).

- **Mechanism (`_update` & `_marketTransfer` flag):** OpenZeppelin ERC721 v5 funnels all token movements (minting, burning, and transferring) through internal hook `_update(address to, uint256 tokenId, address auth)`. In `TicketNFT`, `_update` enforces:
  ```solidity
  require(from == address(0) || _marketTransfer, "Use marketplace");
  require(to != address(0), "Burn disabled");
  ```
  The transient boolean `_marketTransfer` is flipped to `true` exclusively during execution of `buyResale()`, and reset to `false` immediately afterwards.
- **Why approvals cannot bypass the lock:** Calling `approve(operator, tokenId)` or `setApprovalForAll(operator, true)` only sets allowance mappings. When an approved operator attempts `transferFrom` or `safeTransferFrom`, ERC721 calls `_update`. Because `from != address(0)` and `_marketTransfer == false`, the call always reverts with `"Use marketplace"`.
- **Mint allowed and burn blocked:** During minting, tokens originate from `address(0)` (`from == address(0)`), satisfying the require condition. Token burns supply `to == address(0)`, which is unconditionally rejected by `require(to != address(0), "Burn disabled")`.

## Price cap and royalty math
FairPass mandates that resale prices remain bounded and organizer royalties are credited transparently without rounding loss or dust accumulation.

- **Formulas:**
  - **Resale Price Cap:** `maxResalePrice = (faceValue * (100 + capPercent)) / 100`
  - **Cap Nature:** Inclusive; a seller can list at any price satisfying `0 < price <= maxResalePrice`.
  - **Organizer Royalty:** `royalty = (price * royaltyPercent) / 100` (integer division truncates/rounds down).
  - **Seller Payout:** `sellerShare = price - royalty` (computed strictly by subtraction, ensuring `royalty + sellerShare == price` exactly with zero remainder down to 1 wei).
- **Worked Example (0.055 ETH Sale):**
  - Event Parameters: `faceValue` = 0.05 ETH, `capPercent` = 20%, `royaltyPercent` = 10%.
  - Max Resale Price: `(0.05 ETH * (100 + 20)) / 100 = 0.06 ETH`.
  - Sale Price: 0.055 ETH (`55,000,000,000,000,000` wei, which is `<= 0.06 ETH`).
  - Organizer Royalty: `(0.055 ETH * 10) / 100 = 0.0055 ETH` (`5,500,000,000,000,000` wei).
  - Seller Share: `0.055 ETH - 0.0055 ETH = 0.0495 ETH` (`49,500,000,000,000,000` wei).
  - Total Distributed: `0.0055 ETH + 0.0495 ETH = 0.055 ETH` (exact match, 0 wei lost).

## Payments
Financial settlement uses the pull payment pattern rather than push transfers, preventing DoS attack vectors and reentrancy vulnerabilities.

- **Pending balances & Pull payment:** Resale proceeds are not pushed directly to recipients via external calls inside `buyResale`. Instead, proceeds accumulate in `pending[organizer]` and `pending[seller]`. Users claim their ETH by invoking `withdraw()`.
- **Checks-Effects-Interactions (CEI):** In `withdraw()`, the account's pending balance is cached and zeroed out before transferring native ETH:
  ```solidity
  uint256 amount = pending[msg.sender];
  require(amount > 0, "Nothing to withdraw");
  pending[msg.sender] = 0;
  (bool ok, ) = payable(msg.sender).call{value: amount}("");
  require(ok, "Withdraw failed");
  ```
- **`nonReentrant` Guard:** Both `buyResale()` and `withdraw()` are annotated with OpenZeppelin's `nonReentrant` modifier, providing multi-layered defense against same-function and cross-function reentrant invocations.

## Resale rules
1. **Price Cap & Non-Zero Price:** Resale price must be positive (`price > 0`) and cannot exceed `maxResalePrice(ticketId)`.
2. **Two Resales Maximum:** Secondary transfers are capped by `MAX_RESALES = 2`. Each purchase increments `resaleCount[ticketId]`. A third listing attempt reverts with `"Max resales reached"`.
3. **24-Hour Resale Lock:** Tickets cannot be listed within 24 hours of the scheduled event date (`block.timestamp + RESALE_LOCK < e.date`, where `RESALE_LOCK = 1 days`).
4. **Used Ticket Restriction:** Once a ticket is marked used (`used[ticketId] == true`), it cannot be listed (`"Ticket used"` in `listForResale`) nor purchased (`"Ticket used"` in `buyResale`).

## Revert strings
The table below documents every revert string emitted by Person 2's functions and the exact conditions that trigger them:

| Function | Revert String | Trigger Condition |
| :--- | :--- | :--- |
| `listForResale` | `"Not owner"` | Caller is not the current owner of `ticketId` (`ownerOf(ticketId) != msg.sender`). |
| `listForResale` | `"Ticket used"` | Ticket has already been checked in or marked used (`used[ticketId] == true`). |
| `listForResale` | `"Max resales reached"` | Ticket has already reached or exceeded the resale limit (`resaleCount[ticketId] >= 2`). |
| `listForResale` | `"Resale locked"` | Listing within 24 hours of event start (`block.timestamp + 1 days >= e.date`). |
| `listForResale` | `"Bad price"` | Listing price specified as zero (`price == 0`). |
| `listForResale` | `"Above cap"` | Listing price exceeds maximum allowed price (`price > maxResalePrice(ticketId)`). |
| `cancelListing` | `"Not owner"` | Caller is not the current owner of `ticketId` (`ownerOf(ticketId) != msg.sender`). |
| `cancelListing` | `"Not listed"` | Ticket is not currently listed (`listings[ticketId] == 0`). |
| `buyResale` | `"Not listed"` | Ticket is not actively listed for resale (`listings[ticketId] == 0`). |
| `buyResale` | `"Bad payment"` | Sent ETH does not exactly match the listing price (`msg.value != price`). |
| `buyResale` | `"Ticket used"` | Ticket was used while listed (`used[ticketId] == true`). |
| `buyResale` | `"Own ticket"` | Caller attempts to purchase their own ticket (`seller == msg.sender`). |
| `withdraw` | `"Nothing to withdraw"` | Caller has zero pending balance (`pending[msg.sender] == 0`). |
| `withdraw` | `"Withdraw failed"` | Native ETH transfer to caller failed (`ok == false`). |
| `_update` | `"Use marketplace"` | Direct transfer attempted without market authorization (`from != address(0) && !_marketTransfer`). |
| `_update` | `"Burn disabled"` | Attempt to transfer ticket to zero address (`to == address(0)`). |

## Known limitations
1. **Wallet / Private Key Off-Platform Sales:** While ERC721 transfers are constrained on-chain, an owner could conceivably sell custody of the entire private key or smart wallet holding the ticket off-platform.
2. **Purchases During Lock Window:** The 24-hour resale lock enforces `block.timestamp + RESALE_LOCK < e.date` at the time of *listing* (`listForResale`), but does not check the time window during *purchase* (`buyResale`). Consequently, a ticket listed prior to the 24-hour cutoff can still be purchased inside the 24-hour window unless cancelled by the seller.
3. **Temporary Test Harness:** `TicketNFTHarness` is a temporary test-only contract facilitating testing in isolation, and must be deprecated once Person 1's primary sale minting and event creation workflows are merged.
