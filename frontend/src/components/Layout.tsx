import { NavLink, Outlet } from 'react-router-dom';
import { useWallet } from '../context/WalletContext';
import { CHAIN_ID, CHAIN_NAME, USE_MOCK } from '../lib/config';
import { shortAddr } from '../lib/format';

const links = [
  { to: '/', label: 'Events', end: true },
  { to: '/tickets', label: 'My tickets' },
  { to: '/marketplace', label: 'Marketplace' },
  { to: '/organizer', label: 'Organizer' },
  { to: '/venue/scan', label: 'Venue Scanner' },
  { to: '/dev', label: 'Dev & Testnet' },
];

export default function Layout() {
  const { address, balance, chainId, networkName, connect, connecting, wrongNetwork, switchNetwork } = useWallet();

  const isLocalChain = chainId === 31337;

  return (
    <div className="flex min-h-screen flex-col">
      {USE_MOCK && (
        <div className="bg-ink px-4 py-1.5 text-center text-xs font-medium text-white">
          Demo mode: showing sample data. Nothing here touches the blockchain.
        </div>
      )}
      {wrongNetwork && (
        <div className="flex flex-wrap items-center justify-center gap-3 bg-cap-soft px-4 py-2 text-sm font-medium text-cap" role="alert">
          Your wallet is on {networkName ?? `Chain ${chainId}`} instead of {CHAIN_NAME} ({CHAIN_ID}).
          <button className="btn btn-primary !px-3 !py-1" onClick={() => switchNetwork(CHAIN_ID)}>
            Switch to {CHAIN_NAME} ({CHAIN_ID})
          </button>
        </div>
      )}
      <header className="border-b border-ink/10 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3">
          <NavLink to="/" className="font-display text-2xl font-bold tracking-tight">
            FairPass
          </NavLink>
          <nav className="order-last flex w-full gap-1 overflow-x-auto sm:order-none sm:w-auto" aria-label="Main">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.end}
                className={({ isActive }) =>
                  `whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                    isActive ? 'bg-brand-soft text-brand-dark' : 'text-mute hover:bg-ink/5'
                  }`
                }
              >
                {l.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            {address && networkName && (
              <span
                className={`hidden md:inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                  isLocalChain ? 'bg-brand-soft text-brand-dark' : 'bg-ink/5 text-mute'
                }`}
              >
                {networkName}
              </span>
            )}
            {address ? (
              <div
                className="flex items-center gap-2 rounded-full border border-ink/15 px-3 py-1.5 font-mono text-sm bg-white"
                title={address}
              >
                {balance !== null && (
                  <span className="font-bold text-ok">
                    {Number(balance).toLocaleString(undefined, { maximumFractionDigits: 2 })} ETH
                  </span>
                )}
                <span className="text-mute/40">|</span>
                <span>{shortAddr(address)}</span>
              </div>
            ) : (
              <button className="btn btn-primary" onClick={connect} disabled={connecting}>
                {connecting ? 'Connecting…' : 'Connect wallet'}
              </button>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">
        <Outlet />
      </main>
    </div>
  );
}
