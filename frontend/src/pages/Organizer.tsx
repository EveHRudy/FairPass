import { useState, type ChangeEvent, type FormEvent } from 'react';
import { isAddress, parseEther } from 'ethers';
import WalletGate from '../components/WalletGate';
import { EmptyState, ErrorNote, PageHeader, Spinner } from '../components/ui';
import { useWallet } from '../context/WalletContext';
import { useToast } from '../context/ToastContext';
import { useData } from '../context/DataContext';
import { useAsync } from '../hooks/useAsync';
import * as api from '../lib/api';
import * as chain from '../lib/chain';
import { fmtDate, fmtEth, nowSec, parseError } from '../lib/format';
import type { EventInfo, Web3Ctx } from '../types';

export default function Organizer() {
  return (
    <>
      <PageHeader title="Organizer dashboard">Create events, track what they earn, and manage who can scan tickets at the door.</PageHeader>
      <WalletGate reason="Connect the wallet you use to run your events.">{(address) => <Dashboard address={address} />}</WalletGate>
    </>
  );
}

function Dashboard({ address }: { address: string }) {
  const { signer } = useWallet();
  const ctx: Web3Ctx = { signer, address };
  const toast = useToast();
  const { refresh } = useData();
  const [withdrawing, setWithdrawing] = useState(false);

  const { data, error, loading, reload } = useAsync(async () => {
    const [events, pending] = await Promise.all([api.getOrganizerEvents(address), chain.getPending(ctx)]);
    return { events, pending };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  async function withdraw() {
    setWithdrawing(true);
    try {
      const hash = await chain.withdraw(ctx);
      toast.push('success', 'Withdrawal sent to your wallet.', hash);
      refresh();
    } catch (e) {
      toast.push('error', parseError(e));
    } finally {
      setWithdrawing(false);
    }
  }

  if (loading && !data) return <Spinner label="Loading your events" />;
  if (error) return <ErrorNote message={error} onRetry={reload} />;
  if (!data) return null;

  const { events, pending } = data;
  const sold = events.reduce((n, e) => n + e.sold, 0);
  const primary = events.reduce((n, e) => n + BigInt(e.faceValue) * BigInt(e.sold), 0n);
  const royalties = events.reduce((n, e) => n + BigInt(e.royaltyEarned ?? '0'), 0n);
  const hasRoyaltyData = events.some((e) => e.royaltyEarned !== undefined);

  return (
    <div className="grid gap-8">
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Events" value={String(events.length)} />
        <Stat label="Tickets sold" value={String(sold)} />
        <Stat label="Primary sales" value={`${fmtEth(primary)} ETH`} />
        <Stat label="Resale royalties" value={hasRoyaltyData ? `${fmtEth(royalties)} ETH` : 'Not available yet'} />
      </section>

      <section className="panel flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold">Available to withdraw</h2>
          <p className="text-3xl font-bold">{fmtEth(pending)} ETH</p>
          <p className="text-sm text-mute">Includes ticket sales and resale royalties credited to your wallet.</p>
        </div>
        <button className="btn btn-primary" onClick={withdraw} disabled={withdrawing || BigInt(pending) === 0n}>
          {withdrawing ? 'Waiting for wallet…' : 'Withdraw'}
        </button>
      </section>

      <section>
        <h2 className="mb-3 text-2xl font-bold">Your events</h2>
        {events.length === 0 ? (
          <EmptyState title="No events yet" hint="Create your first event with the form below." />
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-ink/10 bg-white">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead className="border-b border-ink/10 text-mute">
                <tr>
                  <th className="p-3 font-medium">Event</th>
                  <th className="p-3 font-medium">Date</th>
                  <th className="p-3 font-medium">Sold</th>
                  <th className="p-3 font-medium">Primary sales</th>
                  <th className="p-3 font-medium">Royalties</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id} className="border-b border-ink/5 last:border-0">
                    <td className="p-3 font-semibold">{e.name}</td>
                    <td className="p-3">{fmtDate(e.date)}</td>
                    <td className="p-3">
                      {e.sold} / {e.supply}
                    </td>
                    <td className="p-3">{fmtEth(BigInt(e.faceValue) * BigInt(e.sold))} ETH</td>
                    <td className="p-3">{e.royaltyEarned !== undefined ? `${fmtEth(e.royaltyEarned)} ETH` : 'n/a'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        <CreateEventForm ctx={ctx} onCreated={refresh} />
        <VenueForm ctx={ctx} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel">
      <p className="text-sm text-mute">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </div>
  );
}

function CreateEventForm({ ctx, onCreated }: { ctx: Web3Ctx; onCreated: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: '', date: '', price: '', supply: '', cap: '10', royalty: '10' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);

    const date = Math.floor(new Date(f.date).getTime() / 1000);
    const supply = Number(f.supply);
    const cap = Number(f.cap);
    const royalty = Number(f.royalty);
    let faceValueWei = 0n;
    try {
      faceValueWei = parseEther(f.price.trim() || '0');
    } catch {
      return setErr('Enter a valid ticket price in ETH.');
    }

    // These limits are checked on-chain too (Person 1), so they are only here to give instant feedback.
    if (!f.name.trim()) return setErr('Enter an event name.');
    if (!f.date || Number.isNaN(date) || date <= nowSec()) return setErr('Pick a date and time in the future.');
    if (faceValueWei <= 0n) return setErr('Ticket price must be above 0.');
    if (!Number.isInteger(supply) || supply <= 0) return setErr('Supply must be a whole number above 0.');
    // INTEGRATION (Person 1): align these limits with the "sensible limits" enforced in createEvent
    if (!Number.isInteger(cap) || cap < 0 || cap > 100) return setErr('Resale cap must be a whole number from 0 to 100.');
    if (!Number.isInteger(royalty) || royalty < 0 || royalty > 50) return setErr('Royalty must be a whole number from 0 to 50.');

    setBusy(true);
    try {
      const hash = await chain.createEvent(ctx, { name: f.name.trim(), date, faceValueWei, supply, capPercent: cap, royaltyPercent: royalty });
      toast.push('success', `Event "${f.name.trim()}" created.`, hash);
      setF({ name: '', date: '', price: '', supply: '', cap: '10', royalty: '10' });
      onCreated();
    } catch (e2) {
      setErr(parseError(e2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel grid gap-4" onSubmit={submit} noValidate>
      <h2 className="text-xl font-bold">Create an event</h2>
      <div>
        <label className="label" htmlFor="ev-name">Event name</label>
        <input id="ev-name" className="input" value={f.name} onChange={set('name')} />
      </div>
      <div>
        <label className="label" htmlFor="ev-date">Date and time</label>
        <input id="ev-date" type="datetime-local" className="input" value={f.date} onChange={set('date')} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label" htmlFor="ev-price">Ticket price (ETH)</label>
          <input id="ev-price" className="input" inputMode="decimal" value={f.price} onChange={set('price')} />
        </div>
        <div>
          <label className="label" htmlFor="ev-supply">Tickets available</label>
          <input id="ev-supply" className="input" inputMode="numeric" value={f.supply} onChange={set('supply')} />
        </div>
        <div>
          <label className="label" htmlFor="ev-cap">Resale cap (% above price)</label>
          <input id="ev-cap" className="input" inputMode="numeric" value={f.cap} onChange={set('cap')} />
        </div>
        <div>
          <label className="label" htmlFor="ev-royalty">Royalty (% of resale)</label>
          <input id="ev-royalty" className="input" inputMode="numeric" value={f.royalty} onChange={set('royalty')} />
        </div>
      </div>
      {err && <p className="rounded-lg bg-bad-soft p-3 text-sm text-bad" role="alert">{err}</p>}
      <button className="btn btn-primary" type="submit" disabled={busy}>
        {busy ? 'Waiting for wallet…' : 'Create event'}
      </button>
    </form>
  );
}

function VenueForm({ ctx }: { ctx: Web3Ctx }) {
  const toast = useToast();
  const [venue, setVenue] = useState('');
  const [busy, setBusy] = useState<'add' | 'remove' | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run(add: boolean) {
    setErr(null);
    if (!isAddress(venue.trim())) return setErr('Enter a valid wallet address starting with 0x.');
    setBusy(add ? 'add' : 'remove');
    try {
      const hash = await chain.setVenue(ctx, venue.trim(), add);
      toast.push('success', add ? 'Venue scanner added.' : 'Venue scanner removed.', hash);
      setVenue('');
    } catch (e) {
      setErr(parseError(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="panel grid content-start gap-4">
      <h2 className="text-xl font-bold">Venue scanners</h2>
      <p className="text-sm text-mute">
        Addresses added here can check tickets in at the door. Remove an address when a scanner is no longer trusted.
      </p>
      <div>
        <label className="label" htmlFor="venue-addr">Scanner wallet address</label>
        <input id="venue-addr" className="input font-mono" placeholder="0x…" value={venue} onChange={(e) => setVenue(e.target.value)} />
      </div>
      {err && <p className="rounded-lg bg-bad-soft p-3 text-sm text-bad" role="alert">{err}</p>}
      <div className="flex gap-3">
        <button className="btn btn-primary" onClick={() => run(true)} disabled={busy !== null}>
          {busy === 'add' ? 'Waiting for wallet…' : 'Add scanner'}
        </button>
        <button className="btn btn-danger" onClick={() => run(false)} disabled={busy !== null}>
          {busy === 'remove' ? 'Waiting for wallet…' : 'Remove scanner'}
        </button>
      </div>
    </div>
  );
}
