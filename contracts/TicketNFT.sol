// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract TicketNFT is ERC721, ERC721URIStorage, Ownable, ReentrancyGuard {
    uint256 public constant MAX_TICKETS_PER_WALLET = 4;
    uint256 public constant MAX_RESALES = 2;
    uint256 public constant RESALE_LOCK = 1 days;

    struct EventInfo {
        address organizer;
        uint256 date;
        uint256 faceValue;
        uint256 supply;
        uint256 sold;
        uint8 capPercent;
        uint8 royaltyPercent;
    }

    uint256 public nextEventId = 1;
    uint256 internal _nextTicketId = 1;
    bool internal _marketTransfer;

    mapping(uint256 => EventInfo) public events;
    mapping(uint256 => uint256) public ticketEvent;
    mapping(uint256 => uint256) public listings;
    mapping(uint256 => bool) public used;
    mapping(uint256 => uint8) public resaleCount;
    mapping(address => uint256) public pending;
    mapping(uint256 => mapping(address => bool)) public isVenue;
    mapping(uint256 => mapping(address => uint256)) public boughtBy;

    event EventCreated(
        uint256 indexed eventId,
        address indexed organizer,
        string name,
        uint256 date,
        uint256 faceValue,
        uint256 supply,
        uint8 capPercent,
        uint8 royaltyPercent
    );
    event TicketMinted(uint256 indexed ticketId, uint256 indexed eventId, address indexed buyer, uint256 price);
    event Listed(uint256 indexed ticketId, address indexed seller, uint256 price);
    event ListingCancelled(uint256 indexed ticketId);
    event Sold(uint256 indexed ticketId, address indexed seller, address indexed buyer, uint256 price, uint256 royalty);
    event CheckedIn(uint256 indexed ticketId, address indexed by);
    event Withdrawn(address indexed account, uint256 amount);
    event VenueAdded(uint256 indexed eventId, address indexed venue);
    event VenueRemoved(uint256 indexed eventId, address indexed venue);

    constructor() ERC721("EventTicket", "TIX") Ownable(msg.sender) {}

    // ===== Person 1 =====

    /// @notice Create a new event. The caller becomes its organizer.
    /// @dev The event name is emitted but not stored on-chain.
    /// @param name Event name (emitted only).
    /// @param date Event start as a unix timestamp. Must be in the future.
    /// @param faceValue Primary sale price in wei. Must be above zero.
    /// @param supply Number of tickets available. Must be above zero.
    /// @param capPercent Max resale premium over face value, 0 to 100.
    /// @param royaltyPercent Share of each resale paid to the organizer, 0 to 50.
    /// @return eventId The id of the new event.
    function createEvent(
        string calldata name,
        uint256 date,
        uint256 faceValue,
        uint256 supply,
        uint8 capPercent,
        uint8 royaltyPercent
    ) external returns (uint256 eventId) {
        require(date > block.timestamp, "Bad date");
        require(faceValue > 0, "Bad face value");
        require(supply > 0, "Bad supply");
        require(capPercent <= 100, "Bad cap");
        require(royaltyPercent <= 50, "Bad royalty");

        eventId = nextEventId++;
        events[eventId] = EventInfo({
            organizer: msg.sender,
            date: date,
            faceValue: faceValue,
            supply: supply,
            sold: 0,
            capPercent: capPercent,
            royaltyPercent: royaltyPercent
        });

        emit EventCreated(eventId, msg.sender, name, date, faceValue, supply, capPercent, royaltyPercent);
    }

    /// @notice Buy one ticket for an event at face value.
    /// @dev Payment is credited to the organizer's pending balance, not sent directly.
    ///      Uses _mint (not _safeMint) so no external callback happens during the purchase.
    /// @param eventId The event to buy a ticket for.
    /// @param uri Metadata URI for the ticket (IPFS link).
    /// @return ticketId The id of the minted ticket.
    function buyTicket(uint256 eventId, string calldata uri)
        external
        payable
        nonReentrant
        returns (uint256 ticketId)
    {
        EventInfo storage e = events[eventId];
        require(e.organizer != address(0), "No such event");
        require(block.timestamp < e.date, "Event passed");
        require(msg.value == e.faceValue, "Bad payment");
        require(e.sold < e.supply, "Sold out");
        require(boughtBy[eventId][msg.sender] < MAX_TICKETS_PER_WALLET, "Wallet limit reached");

        // Effects first
        e.sold += 1;
        boughtBy[eventId][msg.sender] += 1;
        ticketId = _nextTicketId++;
        ticketEvent[ticketId] = eventId;
        pending[e.organizer] += msg.value;

        // Mint
        _mint(msg.sender, ticketId);
        _setTokenURI(ticketId, uri);

        emit TicketMinted(ticketId, eventId, msg.sender, msg.value);
    }

    /// @notice Mark a ticket as used. Callable by the event organizer or an authorized venue.
    /// @param ticketId The ticket being checked in.
    function checkIn(uint256 ticketId) external {
        uint256 eventId = ticketEvent[ticketId];
        require(eventId != 0, "No such ticket");
        require(
            msg.sender == events[eventId].organizer || isVenue[eventId][msg.sender],
            "Not authorized"
        );
        require(!used[ticketId], "Already used");

        used[ticketId] = true;
        emit CheckedIn(ticketId, msg.sender);
    }

    /// @notice Authorize a venue scanner address for an event. Organizer only.
    /// @param eventId The event.
    /// @param venue The scanner address to authorize.
    function addVenue(uint256 eventId, address venue) external {
        require(msg.sender == events[eventId].organizer, "Not authorized");
        require(venue != address(0), "Bad venue");
        isVenue[eventId][venue] = true;
        emit VenueAdded(eventId, venue);
    }

    /// @notice Remove a venue scanner address from an event. Organizer only.
    /// @param eventId The event.
    /// @param venue The scanner address to remove.
    function removeVenue(uint256 eventId, address venue) external {
        require(msg.sender == events[eventId].organizer, "Not authorized");
        isVenue[eventId][venue] = false;
        emit VenueRemoved(eventId, venue);
    }

    // ===== Person 2 =====
    /**
     * @notice Calculates the maximum allowed resale price for a ticket.
     * @dev Price cap is inclusive and computed as: (faceValue * (100 + capPercent)) / 100.
     * @param ticketId The ID of the ticket.
     * @return The maximum allowable resale price in wei.
     */
    function maxResalePrice(uint256 ticketId) public view returns (uint256) {
        EventInfo storage e = events[ticketEvent[ticketId]];
        return (e.faceValue * (100 + e.capPercent)) / 100;
    }

    /**
     * @notice Lists an owned ticket for secondary resale on the marketplace.
     * @dev Validates ticket ownership, usage status, resale count, timing lock, and price cap. Emits {Listed}.
     * @param ticketId The ID of the ticket to list for resale.
     * @param price The listing price in wei.
     *
     * Reverts with:
     * - "Not owner" if the caller is not the owner of the ticket.
     * - "Ticket used" if the ticket has already been used.
     * - "Max resales reached" if the ticket has already reached MAX_RESALES (2).
     * - "Resale locked" if within RESALE_LOCK (24 hours) of event start date.
     * - "Bad price" if the price is 0.
     * - "Above cap" if the price exceeds maxResalePrice(ticketId).
     */
    function listForResale(uint256 ticketId, uint256 price) external {
        require(ownerOf(ticketId) == msg.sender, "Not owner");
        require(!used[ticketId], "Ticket used");
        require(resaleCount[ticketId] < MAX_RESALES, "Max resales reached");
        EventInfo storage e = events[ticketEvent[ticketId]];
        require(block.timestamp + RESALE_LOCK < e.date, "Resale locked");
        require(price > 0, "Bad price");
        require(price <= maxResalePrice(ticketId), "Above cap");
        listings[ticketId] = price;
        emit Listed(ticketId, msg.sender, price);
    }

    /**
     * @notice Cancels an active resale listing for a ticket.
     * @dev Removes the ticket listing and emits {ListingCancelled}.
     * @param ticketId The ID of the ticket whose listing is being cancelled.
     *
     * Reverts with:
     * - "Not owner" if the caller is not the owner of the ticket.
     * - "Not listed" if the ticket is not currently listed for resale.
     */
    function cancelListing(uint256 ticketId) external {
        require(ownerOf(ticketId) == msg.sender, "Not owner");
        require(listings[ticketId] != 0, "Not listed");
        delete listings[ticketId];
        emit ListingCancelled(ticketId);
    }

    /**
     * @notice Purchases a ticket listed for resale on the marketplace.
     * @dev Protected by nonReentrant modifier. Distributes funds via pending balances (pull payment pattern)
     *      and transfers the NFT using the internal _marketTransfer flag. Emits {Sold}.
     * @param ticketId The ID of the ticket to purchase.
     *
     * Reverts with:
     * - "Not listed" if the ticket is not actively listed for resale.
     * - "Bad payment" if the sent msg.value does not match the listing price.
     * - "Ticket used" if the ticket was checked in while listed.
     * - "Own ticket" if the buyer is the current seller/owner of the ticket.
     */
    function buyResale(uint256 ticketId) external payable nonReentrant {
        uint256 price = listings[ticketId];
        require(price != 0, "Not listed");
        require(msg.value == price, "Bad payment");
        require(!used[ticketId], "Ticket used");
        address seller = ownerOf(ticketId);
        require(seller != msg.sender, "Own ticket");
        EventInfo storage e = events[ticketEvent[ticketId]];

        delete listings[ticketId];
        resaleCount[ticketId] += 1;
        uint256 royalty = (price * e.royaltyPercent) / 100;
        pending[e.organizer] += royalty;
        pending[seller] += price - royalty;     // by subtraction so the parts sum exactly to price

        _marketTransfer = true;
        _transfer(seller, msg.sender, ticketId);
        _marketTransfer = false;

        emit Sold(ticketId, seller, msg.sender, price, royalty);
    }

    /**
     * @notice Withdraws accrued ETH from resale payouts or organizer royalties.
     * @dev Uses pull payment pattern with checks-effects-interactions and nonReentrant protection.
     *      Emits {Withdrawn}.
     *
     * Reverts with:
     * - "Nothing to withdraw" if the caller has 0 pending balance.
     * - "Withdraw failed" if the external ETH call to the caller fails.
     */
    function withdraw() external nonReentrant {
        uint256 amount = pending[msg.sender];
        require(amount > 0, "Nothing to withdraw");
        pending[msg.sender] = 0;
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        require(ok, "Withdraw failed");
        emit Withdrawn(msg.sender, amount);
    }

    /**
     * @notice Internal hook restricting token updates to marketplace sales and mints.
     * @dev Overrides ERC721 _update to block peer-to-peer transfers and burning.
     * @param to Destination address.
     * @param tokenId Token ID being transferred.
     * @param auth Authorizing address.
     * @return The previous owner of tokenId.
     *
     * Reverts with:
     * - "Use marketplace" if this is a direct transfer (from != address(0) and _marketTransfer is false).
     * - "Burn disabled" if attempting to transfer to address(0).
     */
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        require(from == address(0) || _marketTransfer, "Use marketplace");
        require(to != address(0), "Burn disabled");
        return super._update(to, tokenId, auth);
    }

    function tokenURI(uint256 tokenId) public view override(ERC721, ERC721URIStorage) returns (string memory) {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, ERC721URIStorage) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
