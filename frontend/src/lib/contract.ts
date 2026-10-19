import { Contract, type ContractRunner } from 'ethers';

// INTEGRATION (Person 1): paste the deployed Sepolia address into .env as VITE_CONTRACT_ADDRESS
export const CONTRACT_ADDRESS: string = import.meta.env.VITE_CONTRACT_ADDRESS ?? '';

// INTEGRATION (Person 1): once the exported ABI file is ready, copy it to src/lib/abi/TicketNFT.json,
// then replace the array below with:  import abi from './abi/TicketNFT.json';  export const TICKET_ABI = abi;
// The entries below are written from the work-split PDF; function names and argument order must match the real contract.
export const TICKET_ABI = [
  'function createEvent(string name, uint256 date, uint256 faceValue, uint256 supply, uint256 capPercent, uint256 royaltyPercent) returns (uint256)',
  'function buyTicket(uint256 eventId) payable',
  'function checkIn(uint256 ticketId)',
  // INTEGRATION (Person 1): confirm the venue role function names
  'function addVenue(address venue)',
  'function removeVenue(address venue)',
  'function listForResale(uint256 ticketId, uint256 price)',
  'function cancelListing(uint256 ticketId)',
  'function buyResale(uint256 ticketId) payable',
  'function withdraw()',
  'function pending(address) view returns (uint256)',
  'function used(uint256) view returns (bool)',
  'function ticketEvent(uint256) view returns (uint256)',
  'function ownerOf(uint256) view returns (address)',
  'function tokenURI(uint256) view returns (string)',
  // INTEGRATION (Person 1 + 2): field order must match the shared EventInfo struct
  'function events(uint256) view returns (string name, uint256 date, uint256 faceValue, uint256 supply, uint256 sold, uint256 capPercent, uint256 royaltyPercent, address organizer)',
] as const;

export function getContract(runner: ContractRunner): Contract {
  return new Contract(CONTRACT_ADDRESS, TICKET_ABI, runner);
}
