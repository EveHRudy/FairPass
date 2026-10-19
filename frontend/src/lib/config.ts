export const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';
export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api';

export interface NetworkConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  currency: { name: string; symbol: string; decimals: number };
  explorerUrl?: string;
}

export const SUPPORTED_NETWORKS: Record<number, NetworkConfig> = {
  31337: {
    chainId: 31337,
    name: 'Hardhat Localhost',
    rpcUrl: 'http://127.0.0.1:8545',
    currency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  11155111: {
    chainId: 11155111,
    name: 'Sepolia Testnet',
    rpcUrl: 'https://rpc.sepolia.org',
    currency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
    explorerUrl: 'https://sepolia.etherscan.io',
  },
};

export const CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? 11155111);
export const CHAIN_NAME = SUPPORTED_NETWORKS[CHAIN_ID]?.name ?? 'Sepolia';
export const EXPLORER_URL = SUPPORTED_NETWORKS[CHAIN_ID]?.explorerUrl ?? 'https://sepolia.etherscan.io';

export function getNetworkInfo(id: number | null): NetworkConfig | null {
  if (!id) return null;
  return SUPPORTED_NETWORKS[id] ?? {
    chainId: id,
    name: `Chain ${id}`,
    rpcUrl: '',
    currency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  };
}

/** Shared agreement: resale is locked this many hours before the event starts. */
export const RESALE_LOCK_HOURS = 24;
export const MOCK_ADDRESS = '0xA11CE00000000000000000000000000000000001';
