import { useState } from 'react';
import Stub from '../components/Stub';
import { EmptyState, ErrorNote, PageHeader, Spinner } from '../components/ui';
import { useWallet } from '../context/WalletContext';
import { useToast } from '../context/ToastContext';
import { useData } from '../context/DataContext';
import { useAsync } from '../hooks/useAsync';
import * as api from '../lib/api';
import * as chain from '../lib/chain';
import { fmtDate, fmtEth, parseError, shortAddr } from '../lib/format';
import type { Listing } from '../types';

export default function Marketplace() {
  const { address, signer, connect, wrongNetwork } = useWallet();
  const toast = useToast();
  const { refresh } = useData();
  const { data, error, loading, reload } = useAsync(async () => {
    const [listings, events] = await Promise.all([api.getListings(), api.getEvents()]);
    return { listings, events: new Map(events.map((e) => [e.id, e])) };
  }, []);
  const [filter, setFilter] = useState('all');
  const [buying, setBuying] = useState<number | null>(null);

  async function buy(l: Listing) {
    if (!address) return connect();
    setBuying(l.ticketId);
    try {
      const hash = await chain.buyResale({ signer, address }, l);
      toast.push('success', `You bought ticket #${l.ticketId}.`, hash);
      refresh();
    } catch (e) {
      toast.push('error', parseError(e));
    } finally {
      setBuying(null);
    }
  }

  const listings = (data?.listings ?? [])
    .filter((l) => filter === 'all' || String(l.eventId) === filter)
    .sort((a, b) => (BigInt(a.price) < BigInt(b.price) ? -1 : 1));

  return (
    <>
      <PageHeader title="Marketplace">
        Resale tickets from other fans. Every price is within the organizer's cap, and part of each sale goes back to the organizer.
      </PageHeader>

      {loading && !data && <Spinner label="Loading listings" />}
      {error && <ErrorNote message={error} onRetry={reload} />}

      {data && (
        <>
          <div className="mb-6 max-w-xs">
            <label className="label" htmlFor="event-filter">
              Event
            </label>
            <select id="event-filter" className="input" value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="all">All events</option>
              {[...data.events.values()].map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </div>

          {listings.length === 0 ? (
            <EmptyState title="No tickets listed" hint="When someone lists a ticket for resale, it will appear here." />
          ) : (
            <div className="grid gap-5">
              {listings.map((l) => {
                const e = data.events.get(l.eventId);
                if (!e) return null;
                const price = BigInt(l.price);
                const royalty = (price * BigInt(e.royaltyPercent)) / 100n;
                const markup = Number((price * 100n) / BigInt(e.faceValue)) - 100;
                const own = !!address && l.seller.toLowerCase() === address.toLowerCase();
                return (
                  <Stub
                    key={l.ticketId}
                    main={
                      <>
                        <h2 className="text-2xl font-bold">{e.name}</h2>
                        <p className="mt-2 text-mute">{fmtDate(e.date)}</p>
                        <p className="text-mute">
                          Ticket #{l.ticketId}, sold by <span className="font-mono">{shortAddr(l.seller)}</span>
                        </p>
                        <p className="mt-3 text-sm text-mute">
                          Face value {fmtEth(e.faceValue)} ETH. {markup > 0 ? `${markup}% above face value.` : 'Listed at face value.'}{' '}
                          Organizer royalty: {fmtEth(royalty)} ETH ({e.royaltyPercent}%).
                        </p>
                      </>
                    }
                    tail={
                      <>
                        <p className="text-2xl font-bold">{fmtEth(l.price)} ETH</p>
                        <button
                          className="btn btn-primary mt-3 w-full"
                          onClick={() => buy(l)}
                          disabled={own || buying === l.ticketId || wrongNetwork}
                        >
                          {own ? 'Your listing' : buying === l.ticketId ? 'Waiting for wallet…' : address ? 'Buy ticket' : 'Connect to buy'}
                        </button>
                      </>
                    }
                  />
                );
              })}
            </div>
          )}
        </>
      )}
    </>
  );
}
