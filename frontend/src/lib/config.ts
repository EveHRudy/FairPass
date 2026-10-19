export const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';
export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api';
export const CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? 11155111);
export const CHAIN_NAME = 'Sepolia';
export const EXPLORER_URL = 'https://sepolia.etherscan.io';

/** Shared agreement: resale is locked this many hours before the event starts. */
export const RESALE_LOCK_HOURS = 24;
export const MOCK_ADDRESS = '0xA11CE00000000000000000000000000000000001';
