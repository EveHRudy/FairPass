import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ErrorNote, Spinner } from '../components/ui';
import { useWallet } from '../context/WalletContext';
import { useToast } from '../context/ToastContext';
import { useData } from '../context/DataContext';
import { useAsync } from '../hooks/useAsync';
import * as api from '../lib/api';
import * as chain from '../lib/chain';
import { fmtDate, fmtEth, isPast, maxResalePrice, parseError, remaining } from '../lib/format';
import { RESALE_LOCK_HOURS } from '../lib/config';

type Phase = 'idle' | 'pending' | 'success' | 'error';

export default function EventDetails() {
  const eventId = Number(useParams().id);
  const { data: event, error, loading, reload } = useAsync(() => api.getEvent(eventId), [eventId]);
  const { address, signer, connect, connecting, wrongNetwork } = useWallet();
  const toast = useToast();
  const { refresh } = useData();
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState('');

  if (loading && !event) return <Spinner label="Loading event" />;
  if (error || !event) return <ErrorNote message={error ?? 'Event not found.'} onRetry={reload} />;

  const left = remaining(event);
  const unavailable = left <= 0 ? 'Sold out' : isPast(event) ? 'Event ended' : null;

  async function buy() {
    if (!event || !address) return;
    setPhase('pending');
    setMessage('Confirm the purchase in your wallet…');
    try {
      const hash = await chain.buyTicket({ signer, address }, event);
      setPhase('success');
      setMessage('Ticket purchased. It is now in your wallet.');
      toast.push('success', `Ticket for ${event.name} purchased.`, hash);
      refresh();
    } catch (e) {
      setPhase('error');
      setMessage(parseError(e));
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
      <section>
        <Link to="/" className="text-sm font-semibold text-brand-dark underline">
          All events
        </Link>
        <h1 className="mt-3 text-4xl font-bold leading-tight sm:text-5xl">{event.name}</h1>
        <p className="mt-3 text-lg text-mute">{fmtDate(event.date)}</p>
        {event.venue && <p className="text-lg text-mute">{event.venue}</p>}

        <div className="panel mt-8">
          <h2 className="text-xl font-bold">How resale works</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-mute">
            <li>
              You can resell for at most {fmtEth(maxResalePrice(event.faceValue, event.capPercent))} ETH (face value plus{' '}
              {event.capPercent}%).
            </li>
            <li>The organizer receives {event.royaltyPercent}% of every resale price.</li>
            <li>Resale closes {RESALE_LOCK_HOURS} hours before the event starts.</li>
            <li>Tickets cannot be sent wallet to wallet. They can only be resold on this marketplace.</li>
          </ul>
        </div>
      </section>

      <aside>
        <div className="panel">
          <p className="text-sm text-mute">Ticket price</p>
          <p className="text-3xl font-bold">{fmtEth(event.faceValue)} ETH</p>
          <p className={`mt-2 text-sm font-semibold ${unavailable ? 'text-bad' : 'text-ok'}`}>
            {unavailable ?? `${left} of ${event.supply} left`}
          </p>

          <div className="mt-5 border-t-2 border-dashed border-ink/20 pt-5">
            {!address ? (
              <button className="btn btn-primary w-full" onClick={connect} disabled={connecting}>
                {connecting ? 'Connecting…' : 'Connect wallet to buy'}
              </button>
            ) : (
              <button className="btn btn-primary w-full" onClick={buy} disabled={!!unavailable || phase === 'pending' || wrongNetwork}>
                {phase === 'pending' ? 'Waiting for wallet…' : `Buy ticket for ${fmtEth(event.faceValue)} ETH`}
              </button>
            )}
            {wrongNetwork && <p className="mt-2 text-sm text-cap">Switch to Sepolia to buy.</p>}
            <div aria-live="polite">
              {phase === 'success' && (
                <p className="mt-3 rounded-lg bg-ok-soft p-3 text-sm text-ok">
                  {message}{' '}
                  <Link className="font-semibold underline" to="/tickets">
                    View my tickets
                  </Link>
                </p>
              )}
              {phase === 'error' && (
                <p className="mt-3 rounded-lg bg-bad-soft p-3 text-sm text-bad" role="alert">
                  {message}
                </p>
              )}
              {phase === 'pending' && <p className="mt-3 text-sm text-mute">{message}</p>}
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
