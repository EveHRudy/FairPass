import { useState } from 'react';
import { Link } from 'react-router-dom';
import Stub from '../components/Stub';
import WalletGate from '../components/WalletGate';
import ListResaleModal from '../components/ListResaleModal';
import QRModal from '../components/QRModal';
import { EmptyState, ErrorNote, PageHeader, Spinner, StatusBadge } from '../components/ui';
import { useWallet } from '../context/WalletContext';
import { useToast } from '../context/ToastContext';
import { useData } from '../context/DataContext';
import { useAsync } from '../hooks/useAsync';
import * as api from '../lib/api';
import * as chain from '../lib/chain';
import { fmtDate, fmtEth, parseError, resaleLocked, ticketStatus } from '../lib/format';
import type { EventInfo, Ticket } from '../types';

export default function MyTickets() {
  return (
    <>
      <PageHeader title="My tickets">Your tickets, their status, and what you can do with each one.</PageHeader>
      <WalletGate reason="Connect your wallet to see the tickets you own.">{(address) => <Tickets address={address} />}</WalletGate>
    </>
  );
}

function Tickets({ address }: { address: string }) {
  const { signer } = useWallet();
  const toast = useToast();
  const { refresh } = useData();
  const { data, error, loading, reload } = useAsync(async () => {
    const [tickets, events] = await Promise.all([api.getTickets(address), api.getEvents()]);
    return { tickets, events: new Map(events.map((e) => [e.id, e])) };
  }, [address]);

  const [listing, setListing] = useState<{ ticket: Ticket; event: EventInfo } | null>(null);
  const [qr, setQr] = useState<{ ticket: Ticket; event: EventInfo } | null>(null);
  const [cancelling, setCancelling] = useState<number | null>(null);

  async function cancel(t: Ticket) {
    setCancelling(t.id);
    try {
      const hash = await chain.cancelListing({ signer, address }, t.id);
      toast.push('success', `Listing for ticket #${t.id} cancelled.`, hash);
      refresh();
    } catch (e) {
      toast.push('error', parseError(e));
    } finally {
      setCancelling(null);
    }
  }

  if (loading && !data) return <Spinner label="Loading your tickets" />;
  if (error) return <ErrorNote message={error} onRetry={reload} />;
  if (!data) return null;

  const rows = data.tickets
    .map((t) => ({ t, e: data.events.get(t.eventId) }))
    .filter((r): r is { t: Ticket; e: EventInfo } => !!r.e)
    .sort((a, b) => a.e.date - b.e.date);

  if (rows.length === 0) {
    return (
      <EmptyState
        title="You don't own any tickets yet"
        hint="Buy a ticket from an event page and it will show up here."
        action={
          <Link className="btn btn-primary" to="/">
            Browse events
          </Link>
        }
      />
    );
  }

  return (
    <>
      <div className="grid gap-5">
        {rows.map(({ t, e }) => {
          const status = ticketStatus(t);
          const locked = resaleLocked(e);
          return (
            <Stub
              key={t.id}
              main={
                <>
                  <div className="flex flex-wrap items-center gap-3">
                    <h2 className="text-2xl font-bold">{e.name}</h2>
                    <StatusBadge status={status} />
                  </div>
                  <p className="mt-2 text-mute">{fmtDate(e.date)}</p>
                  <p className="text-mute">Ticket #{t.id}</p>
                  {status === 'listed' && t.listPrice && (
                    <p className="mt-2 text-sm font-semibold text-cap">Listed at {fmtEth(t.listPrice)} ETH</p>
                  )}
                </>
              }
              tail={
                <div className="flex flex-col gap-2">
                  {status === 'valid' && (
                    <button className="btn btn-primary" onClick={() => setListing({ ticket: t, event: e })} disabled={locked}>
                      List for resale
                    </button>
                  )}
                  {status === 'valid' && locked && <p className="text-xs text-mute">Resale is closed within 24 hours of the event.</p>}
                  {status === 'listed' && (
                    <button className="btn btn-danger" onClick={() => cancel(t)} disabled={cancelling === t.id}>
                      {cancelling === t.id ? 'Cancelling…' : 'Cancel listing'}
                    </button>
                  )}
                  {status !== 'used' && (
                    <button className="btn btn-ghost" onClick={() => setQr({ ticket: t, event: e })}>
                      Show entry QR
                    </button>
                  )}
                  {status === 'used' && <p className="text-sm text-mute">This ticket was used for entry.</p>}
                </div>
              }
            />
          );
        })}
      </div>
      {listing && <ListResaleModal ticket={listing.ticket} event={listing.event} onClose={() => setListing(null)} />}
      {qr && <QRModal ticket={qr.ticket} event={qr.event} onClose={() => setQr(null)} />}
    </>
  );
}
