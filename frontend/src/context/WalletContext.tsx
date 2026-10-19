import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { BrowserProvider, getAddress, type JsonRpcSigner } from 'ethers';
import { CHAIN_ID, CHAIN_NAME, EXPLORER_URL, MOCK_ADDRESS, USE_MOCK } from '../lib/config';
import { parseError } from '../lib/format';

declare global {
  interface Window {
    ethereum?: any;
  }
}

interface WalletState {
  address: string | null;
  signer: JsonRpcSigner | null;
  chainId: number | null;
  wrongNetwork: boolean;
  connecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
  switchNetwork: () => Promise<void>;
}

const Ctx = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [signer, setSigner] = useState<JsonRpcSigner | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (accounts?: string[]) => {
    const eth = window.ethereum;
    if (!eth) return;
    try {
      const provider = new BrowserProvider(eth);
      const accts: string[] = accounts ?? (await provider.send('eth_accounts', []));
      if (!accts.length) {
        setAddress(null);
        setSigner(null);
        setChainId(null);
        return;
      }
      const net = await provider.getNetwork();
      setChainId(Number(net.chainId));
      setSigner(await provider.getSigner(accts[0]));
      setAddress(getAddress(accts[0]));
    } catch (e) {
      setError(parseError(e));
    }
  }, []);

  useEffect(() => {
    load(); // restores the session if the site was already authorised
    const eth = window.ethereum;
    if (!eth?.on) return;
    const onAccounts = (a: string[]) => load(a);
    const onChain = () => load();
    eth.on('accountsChanged', onAccounts);
    eth.on('chainChanged', onChain);
    return () => {
      eth.removeListener?.('accountsChanged', onAccounts);
      eth.removeListener?.('chainChanged', onChain);
    };
  }, [load]);

  const connect = useCallback(async () => {
    setError(null);
    const eth = window.ethereum;
    if (!eth) {
      if (USE_MOCK) {
        setAddress(MOCK_ADDRESS); // no MetaMask in mock mode: use a fake account
        return;
      }
      setError('No wallet found. Install MetaMask to continue.');
      return;
    }
    setConnecting(true);
    try {
      const accts: string[] = await new BrowserProvider(eth).send('eth_requestAccounts', []);
      await load(accts);
    } catch (e) {
      setError(parseError(e));
    } finally {
      setConnecting(false);
    }
  }, [load]);

  const switchNetwork = useCallback(async () => {
    const eth = window.ethereum;
    if (!eth) return;
    const hexId = '0x' + CHAIN_ID.toString(16);
    try {
      await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hexId }] });
    } catch (e: any) {
      if (e?.code === 4902) {
        try {
          await eth.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: hexId,
              chainName: CHAIN_NAME,
              nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
              rpcUrls: ['https://rpc.sepolia.org'],
              blockExplorerUrls: [EXPLORER_URL],
            }],
          });
        } catch (e2) {
          setError(parseError(e2));
        }
      } else {
        setError(parseError(e));
      }
    }
  }, []);

  const wrongNetwork = !USE_MOCK && !!address && chainId !== CHAIN_ID;

  const value = useMemo(
    () => ({ address, signer, chainId, wrongNetwork, connecting, error, connect, switchNetwork }),
    [address, signer, chainId, wrongNetwork, connecting, error, connect, switchNetwork],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): WalletState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWallet must be used inside WalletProvider');
  return v;
}
