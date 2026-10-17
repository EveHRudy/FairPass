import type { ReactNode } from 'react';
import { useWallet } from '../context/WalletContext';
import { EmptyState } from './ui';

/** Renders children only when a wallet is connected, otherwise asks the user to connect. */
export default function WalletGate({ children, reason }: { children: (address: string) => ReactNode; reason: string }) {
  const { address, connect, connecting, error } = useWallet();
  if (address) return <>{children(address)}</>;
  return (
    <EmptyState
      title="Connect your wallet"
      hint={error ?? reason}
      action={
        <button className="btn btn-primary" onClick={connect} disabled={connecting}>
          {connecting ? 'Connecting…' : 'Connect wallet'}
        </button>
      }
    />
  );
}
