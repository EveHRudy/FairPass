import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { BrowserProvider, formatEther, getAddress, type JsonRpcSigner } from 'ethers';
import { CHAIN_ID, CHAIN_NAME, EXPLORER_URL, getNetworkInfo, MOCK_ADDRESS, SUPPORTED_NETWORKS, USE_MOCK } from '../lib/config';
import { parseError } from '../lib/format';

declare global {
  interface Window {
    ethereum?: any;
  }
}

export interface WalletState {
  address: string | null;
  signer: JsonRpcSigner | null;
  chainId: number | null;
  networkName: string | null;
  balance: string | null;
  balanceWei: string | null;
  wrongNetwork: boolean;
  connecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
  switchNetwork: (targetChainId?: number) => Promise<void>;
  refreshBalance: () => Promise<void>;
}

const Ctx = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [signer, setSigner] = useState<JsonRpcSigner | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [balanceWei, setBalanceWei] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchBalance = useCallback(async (account: string, provider: BrowserProvider) => {
    try {
      const bal = await provider.getBalance(account);
      setBalanceWei(bal.toString());
      setBalance(formatEther(bal));
    } catch {
      setBalance(null);
      setBalanceWei(null);
    }
  }, []);

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
        setBalance(null);
        setBalanceWei(null);
        return;
      }
      const net = await provider.getNetwork();
      const currentChainId = Number(net.chainId);
      const currentSigner = await provider.getSigner(accts[0]);
      const currentAddress = getAddress(accts[0]);

      setChainId(currentChainId);
      setSigner(currentSigner);
      setAddress(currentAddress);

      await fetchBalance(currentAddress, provider);
    } catch (e) {
      setError(parseError(e));
    }
  }, [fetchBalance]);

  useEffect(() => {
    load();
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

  const refreshBalance = useCallback(async () => {
    const eth = window.ethereum;
    if (!eth || !address) return;
    const provider = new BrowserProvider(eth);
    await fetchBalance(address, provider);
  }, [address, fetchBalance]);

  const connect = useCallback(async () => {
    setError(null);
    const eth = window.ethereum;
    if (!eth) {
      if (USE_MOCK) {
        setAddress(MOCK_ADDRESS);
        setBalance('100.0');
        setBalanceWei('100000000000000000000');
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

  const switchNetwork = useCallback(async (targetChainId: number = CHAIN_ID) => {
    const eth = window.ethereum;
    if (!eth) return;
    const hexId = '0x' + targetChainId.toString(16);
    const netConfig = SUPPORTED_NETWORKS[targetChainId] ?? getNetworkInfo(targetChainId);

    try {
      await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hexId }] });
    } catch (e: any) {
      if (e?.code === 4902 && netConfig) {
        try {
          await eth.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: hexId,
              chainName: netConfig.name,
              nativeCurrency: netConfig.currency,
              rpcUrls: [netConfig.rpcUrl],
              ...(netConfig.explorerUrl ? { blockExplorerUrls: [netConfig.explorerUrl] } : {}),
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

  const networkInfo = getNetworkInfo(chainId);
  const networkName = networkInfo?.name ?? (chainId ? `Chain ${chainId}` : null);
  const wrongNetwork = !USE_MOCK && !!address && chainId !== CHAIN_ID;

  const value = useMemo(
    () => ({
      address,
      signer,
      chainId,
      networkName,
      balance,
      balanceWei,
      wrongNetwork,
      connecting,
      error,
      connect,
      switchNetwork,
      refreshBalance,
    }),
    [address, signer, chainId, networkName, balance, balanceWei, wrongNetwork, connecting, error, connect, switchNetwork, refreshBalance],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): WalletState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWallet must be used inside WalletProvider');
  return v;
}
