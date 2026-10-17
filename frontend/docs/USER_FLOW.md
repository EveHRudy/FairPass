# User flow walkthrough

## Buy
1. Open **Events** and pick an event.
2. Press **Connect wallet** (MetaMask). If the wallet is on another network, press **Switch to Sepolia** in the banner.
3. On the event page press **Buy ticket**. Confirm in the wallet.
4. The page shows a success message. The ticket appears under **My tickets** with status *Valid*.

## List
1. Open **My tickets** and press **List for resale** on a valid ticket.
2. The modal shows the face value and the maximum allowed price (read from the contract).
3. Enter a price. Anything above the maximum is blocked, and the modal shows what you would receive after the organizer royalty.
4. Press **List ticket** and confirm. Status changes to *Listed for resale*. Use **Cancel listing** to take it back.

## Resell (buyer side)
1. Open **Marketplace**. Each listing shows price, face value and the organizer royalty.
2. Press **Buy ticket** and confirm. The ticket moves to the buyer's **My tickets**.
3. The seller and the organizer can withdraw their share (organizers from the **Organizer** page).

## Enter
1. Open **My tickets** and press **Show entry QR** on an unused ticket.
2. Press **Sign and show QR**. The wallet signs a one-time challenge from the backend.
3. Show the QR at the venue scanner. It expires after about 30 seconds. Press **Generate new QR** if it expires.
4. After a successful scan the ticket shows as *Used*.

## Screenshots needed for the final report
Home, Event details, My tickets, List for resale modal, Marketplace, Organizer dashboard, Entry QR.
