// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ITicketNFT
/// @notice Frozen function signatures for the FairPass ticketing contract.
/// @dev Signatures only. Do not change without agreement from both contract owners and the team.
interface ITicketNFT {
    // ===== Person 1: events, primary sale, check-in, venues =====

    /// @notice Create a new event.
    function createEvent(
        string calldata name,
        uint256 date,
        uint256 faceValue,
        uint256 supply,
        uint8 capPercent,
        uint8 royaltyPercent
    ) external returns (uint256 eventId);

    /// @notice Buy one ticket for an event at face value.
    function buyTicket(uint256 eventId, string calldata uri) external payable returns (uint256 ticketId);

    /// @notice Mark a ticket as used at the door.
    function checkIn(uint256 ticketId) external;

    /// @notice Authorize a venue scanner address for an event.
    function addVenue(uint256 eventId, address venue) external;

    /// @notice Remove a venue scanner address from an event.
    function removeVenue(uint256 eventId, address venue) external;

    // ===== Person 2: resale, cap, royalty, withdrawals =====

    /// @notice List an owned ticket for resale at or below the cap.
    function listForResale(uint256 ticketId, uint256 price) external;

    /// @notice Cancel an active listing.
    function cancelListing(uint256 ticketId) external;

    /// @notice Buy a listed ticket.
    function buyResale(uint256 ticketId) external payable;

    /// @notice Withdraw the caller's pending ETH balance.
    function withdraw() external;

    /// @notice Maximum allowed resale price for a ticket.
    function maxResalePrice(uint256 ticketId) external view returns (uint256);
}
