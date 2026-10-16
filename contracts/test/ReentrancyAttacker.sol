// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../TicketNFT.sol";

// TEST-ONLY contract: This contract exists only for tests.
contract ReentrancyAttacker {
    TicketNFT public immutable targetContract;
    uint8 public mode;
    uint256 public targetTicket;
    bool public reentryAttempted;
    bool public reentryBlocked;

    constructor(address _target) {
        targetContract = TicketNFT(_target);
    }

    function setMode(uint8 _mode) external {
        mode = _mode;
    }

    function setTargetTicket(uint256 _targetTicket) external {
        targetTicket = _targetTicket;
    }

    function buyTicketOnTarget(uint256 eventId, string calldata uri) external payable {
        targetContract.buyTicket{value: msg.value}(eventId, uri);
    }

    function listTicket(uint256 ticketId, uint256 price) external {
        targetContract.listForResale(ticketId, price);
    }

    function attackWithdraw() external {
        targetContract.withdraw();
    }

    receive() external payable {
        if (mode == 1) {
            if (!reentryAttempted) {
                reentryAttempted = true;
                try targetContract.withdraw() {
                    // Re-entry succeeded
                } catch {
                    reentryBlocked = true;
                }
            }
        } else if (mode == 2) {
            if (!reentryAttempted) {
                reentryAttempted = true;
                try targetContract.buyResale{value: address(this).balance}(targetTicket) {
                    // Re-entry succeeded
                } catch {
                    reentryBlocked = true;
                }
            }
        }
    }
}

// TEST-ONLY contract: This contract exists only for tests to verify burn restriction.
contract BurnHarness is TicketNFT {
    function burnForTest(uint256 tokenId) external {
        _marketTransfer = true;
        _burn(tokenId);
        _marketTransfer = false;
    }
}
