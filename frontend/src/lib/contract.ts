import { Contract, type ContractRunner } from 'ethers';

export const SEPOLIA_CONTRACT_ADDRESS = '0x6919957288D51D1b3A514AD2cbfF1Fb202418E5e';
export const LOCALHOST_CONTRACT_ADDRESS = '0x5FbDB2315678afecb367f032d93F642f64180aa3';

// Deployed Sepolia contract address (fallback to localhost when chainId is 31337)
export const CONTRACT_ADDRESS: string =
  import.meta.env.VITE_CONTRACT_ADDRESS ?? (
    Number(import.meta.env.VITE_CHAIN_ID) === 31337 ? LOCALHOST_CONTRACT_ADDRESS : SEPOLIA_CONTRACT_ADDRESS
  );

// ABI matching the deployed TicketNFT on Sepolia and Localhost.
// Field order and types match the on-chain struct exactly.
export const TICKET_ABI = [
  // Person 1 — event lifecycle
  'function createEvent(string name, uint256 date, uint256 faceValue, uint256 supply, uint8 capPercent, uint8 royaltyPercent) returns (uint256)',
  'function buyTicket(uint256 eventId, string uri) payable returns (uint256)',
  'function checkIn(uint256 ticketId)',
  'function addVenue(uint256 eventId, address venue)',
  'function removeVenue(uint256 eventId, address venue)',

  // Person 2 — secondary market
  'function listForResale(uint256 ticketId, uint256 price)',
  'function cancelListing(uint256 ticketId)',
  'function buyResale(uint256 ticketId) payable',
  'function withdraw()',
  'function maxResalePrice(uint256 ticketId) view returns (uint256)',

  // Read-only mappings
  'function pending(address) view returns (uint256)',
  'function used(uint256) view returns (bool)',
  'function ticketEvent(uint256) view returns (uint256)',
  'function ownerOf(uint256) view returns (address)',
  'function tokenURI(uint256) view returns (string)',
  'function listings(uint256) view returns (uint256)',
  'function isVenue(uint256, address) view returns (bool)',
  'function nextEventId() view returns (uint256)',

  // Struct: (address organizer, uint256 date, uint256 faceValue, uint256 supply, uint256 sold, uint8 capPercent, uint8 royaltyPercent)
  'function events(uint256) view returns (address organizer, uint256 date, uint256 faceValue, uint256 supply, uint256 sold, uint8 capPercent, uint8 royaltyPercent)',
] as const;

export function getContract(runner: ContractRunner, addressOverride?: string): Contract {
  return new Contract(addressOverride || CONTRACT_ADDRESS, TICKET_ABI, runner);
}
