import { NavLink, Outlet } from 'react-router-dom';
import { useWallet } from '../context/WalletContext';
import { CHAIN_NAME, USE_MOCK } from '../lib/config';
import { shortAddr } from '../lib/format';

const links = [
  { to: '/', label: 'Events', end: true },
  { to: '/tickets', label: 'My tickets' },
  { to: '/marketplace', label: 'Marketplace' },
  { to: '/organizer', label: 'Organizer' },
  { to: '/venue/scan', label: 'Venue Scanner' },
];

export default function Layout() {
  const { address, connect, connecting, wrongNetwork, switchNetwork } = useWallet();

  return (
    <div className="flex min-h-screen flex-col">
      {USE_MOCK && (
        <div className="bg-ink px-4 py-1.5 text-center text-xs font-medium text-white">
          Demo mode: showing sample data. Nothing here touches the blockchain.
        </div>
      )}
      {wrongNetwork && (
        <div className="flex flex-wrap items-center justify-center gap-3 bg-cap-soft px-4 py-2 text-sm font-medium text-cap" role="alert">
          Your wallet is on the wrong network. Switch to {CHAIN_NAME} to continue.
          <button className="btn btn-primary !px-3 !py-1.5" onClick={switchNetwork}>
            Switch to {CHAIN_NAME}
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
                  `whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold ${isActive ? 'bg-brand-soft text-brand-dark' : 'text-mute hover:bg-ink/5'}`
                }
              >
                {l.label}
              </NavLink>
            ))}
          </nav>
          {address ? (
            <span className="rounded-full border border-ink/15 px-3 py-1.5 font-mono text-sm" title={address}>
              {shortAddr(address)}
            </span>
          ) : (
            <button className="btn btn-primary" onClick={connect} disabled={connecting}>
              {connecting ? 'Connecting…' : 'Connect wallet'}
            </button>
          )}
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">
        <Outlet />
      </main>
    </div>
  );
}
