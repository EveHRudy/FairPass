// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// TEST FIXTURE ONLY. A tiny stand-in that emits the same *shape* of events as the spec so the
/// ethers-based reader can be exercised against a real EVM. It is NOT the project contract.
contract MockTicketing {
    event EventCreated(uint256 indexed eventId, address indexed organizer, string name, string venue, uint256 date, uint256 price, uint256 maxSupply);
    event TicketMinted(uint256 indexed tokenId, uint256 indexed eventId, address indexed to);
    event Listed(uint256 indexed tokenId, address indexed seller, uint256 price);
    event Sold(uint256 indexed tokenId, address indexed seller, address indexed buyer, uint256 price);
    event CheckedIn(uint256 indexed tokenId);

    mapping(uint256 => address) private _owners;
    mapping(uint256 => bool) public isCheckedIn;
    uint256 public maxResaleCapPercent = 10;
    uint256 public royaltyPercent = 5;

    error ERC721NonexistentToken(uint256 tokenId);

    function ownerOf(uint256 tokenId) public view returns (address) {
        address o = _owners[tokenId];
        if (o == address(0)) revert ERC721NonexistentToken(tokenId);
        return o;
    }
    function createEvent(uint256 id, string calldata name, string calldata venue, uint256 date, uint256 price, uint256 maxSupply) external {
        emit EventCreated(id, msg.sender, name, venue, date, price, maxSupply);
    }
    function mint(uint256 tokenId, uint256 eventId, address to) external {
        _owners[tokenId] = to;
        emit TicketMinted(tokenId, eventId, to);
    }
    function list(uint256 tokenId, uint256 price) external { emit Listed(tokenId, ownerOf(tokenId), price); }
    function sell(uint256 tokenId, address buyer, uint256 price) external {
        address seller = ownerOf(tokenId);
        _owners[tokenId] = buyer;
        emit Sold(tokenId, seller, buyer, price);
    }
    function checkIn(uint256 tokenId) external {
        ownerOf(tokenId);
        isCheckedIn[tokenId] = true;
        emit CheckedIn(tokenId);
    }
}
