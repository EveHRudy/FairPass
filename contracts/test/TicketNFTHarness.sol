// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../TicketNFT.sol";

// TEST-ONLY contract: This harness must be deleted once Person 1's functions are merged.
contract TicketNFTHarness is TicketNFT {
    function createEventForTest(
        address organizer,
        uint256 date,
        uint256 faceValue,
        uint256 supply,
        uint8 capPercent,
        uint8 royaltyPercent
    ) external returns (uint256 id) {
        id = nextEventId++;
        events[id] = EventInfo(organizer, date, faceValue, supply, 0, capPercent, royaltyPercent);
    }

    function mintForTest(address to, uint256 eventId) external returns (uint256 id) {
        id = _nextTicketId++;
        ticketEvent[id] = eventId;
        events[eventId].sold++;
        _mint(to, id);
    }

    function markUsedForTest(uint256 ticketId) external {
        used[ticketId] = true;
    }
}
