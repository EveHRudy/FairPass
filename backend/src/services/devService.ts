import { formatEther, getAddress, isAddress } from 'ethers';
import type { AppConfig } from '../config.js';
import type { ChainReader } from '../chain/ChainReader.js';
import { HttpError } from '../errors.js';

export interface DevAccountInfo {
  index: number;
  label: string;
  role: string;
  address: string;
  balanceWei: string;
  balanceEth: string;
  description: string;
}

export const HARDHAT_DEV_ACCOUNTS = [
  {
    index: 0,
    label: 'Account #0 — Deployer & Event Organizer',
    role: 'Contract Deployer & Event Organizer',
    address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    description: 'Deploys TicketNFT, creates events, sets resale caps and royalties, and manages authorized venue scanners.',
  },
  {
    index: 1,
    label: 'Account #1 — Primary Buyer (Alice)',
    role: 'Primary Ticket Buyer',
    address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    description: 'Purchases primary tickets from organizers and requests EIP-191 signed QR check-in challenges.',
  },
  {
    index: 2,
    label: 'Account #2 — Secondary Buyer (Bob)',
    role: 'Marketplace Resale Buyer',
    address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
    description: 'Buys tickets listed on the secondary marketplace under smart contract-enforced price caps.',
  },
  {
    index: 3,
    label: 'Account #3 — Ticket Reseller (Charlie)',
    role: 'Ticket Reseller',
    address: '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
    description: 'Lists owned tickets for resale within the allowed price ceiling and withdraws seller proceeds.',
  },
  {
    index: 4,
    label: 'Account #4 — Venue Door Scanner (Staff)',
    role: 'Authorized Door Staff / Scanner Operator',
    address: '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65',
    description: 'Authorized by the organizer with addVenue(eventId, address) to scan attendee QR codes and confirm entry.',
  },
];

export class DevService {
  constructor(private config: AppConfig, private chain: ChainReader) {}

  private assertNotProduction(): void {
    if (this.config.nodeEnv === 'production') {
      throw new HttpError(403, 'Development endpoints are disabled in production environments', 'DEV_ENDPOINT_DISABLED');
    }
  }

  async getChainStatus() {
    let blockNumber: number | null = null;
    let connected = true;
    try {
      blockNumber = await this.chain.blockNumber();
    } catch {
      connected = false;
    }

    const isLocal =
      this.config.chainId === 31337 ||
      this.config.rpcUrl.includes('127.0.0.1') ||
      this.config.rpcUrl.includes('localhost');

    const networkName =
      this.config.chainId === 31337
        ? 'Hardhat Localhost'
        : this.config.chainId === 11155111
        ? 'Sepolia Testnet'
        : `Chain ID ${this.config.chainId}`;

    return {
      connected,
      chainId: this.config.chainId,
      networkName,
      blockNumber,
      contractAddress: this.chain.contractAddress,
      isLocal,
      rpcUrl: isLocal ? this.config.rpcUrl : '(configured RPC)',
      explorerUrl: this.config.chainId === 11155111 ? 'https://sepolia.etherscan.io' : null,
      instructions: !connected && isLocal
        ? "Local blockchain is not running. In the project root, run 'npx hardhat node' to start the local chain."
        : null,
    };
  }

  async getAccounts(): Promise<{
    chainId: number;
    networkName: string;
    isLocal: boolean;
    accounts: DevAccountInfo[];
    importInstructions: string;
  }> {
    this.assertNotProduction();

    const isLocal =
      this.config.chainId === 31337 ||
      this.config.rpcUrl.includes('127.0.0.1') ||
      this.config.rpcUrl.includes('localhost');

    const networkName =
      this.config.chainId === 31337
        ? 'Hardhat Localhost'
        : this.config.chainId === 11155111
        ? 'Sepolia Testnet'
        : `Chain ID ${this.config.chainId}`;

    const accountsWithBalances: DevAccountInfo[] = await Promise.all(
      HARDHAT_DEV_ACCOUNTS.map(async (acc) => {
        let balanceWei = '0';
        let balanceEth = '0.0';
        try {
          balanceWei = await this.chain.getBalance(acc.address);
          balanceEth = formatEther(balanceWei);
        } catch {
          // If RPC is unavailable, report 0
        }
        return {
          index: acc.index,
          label: acc.label,
          role: acc.role,
          address: getAddress(acc.address),
          balanceWei,
          balanceEth,
          description: acc.description,
        };
      })
    );

    return {
      chainId: this.config.chainId,
      networkName,
      isLocal,
      accounts: accountsWithBalances,
      importInstructions:
        "To import a test account into MetaMask: Open MetaMask -> Click the account selector -> 'Add account or hardware wallet' -> 'Import account' -> Paste the private key. Run 'npm run dev:accounts' in your terminal to safely view the development private keys in your local console.",
    };
  }

  async getBalance(address: string): Promise<{ address: string; balanceWei: string; balanceEth: string }> {
    if (!isAddress(address)) {
      throw new HttpError(400, 'Invalid Ethereum address', 'INVALID_ADDRESS');
    }
    const checksummed = getAddress(address);
    const balanceWei = await this.chain.getBalance(checksummed);
    return {
      address: checksummed,
      balanceWei,
      balanceEth: formatEther(balanceWei),
    };
  }
}
