import { useEffect, useState } from 'react';
import { parseEther } from 'ethers';
import { Modal } from './ui';
import { useWallet } from '../context/WalletContext';
import { useToast } from '../context/ToastContext';
import { useData } from '../context/DataContext';
import * as chain from '../lib/chain';
import { fmtEth, maxResalePrice, parseError } from '../lib/format';
import type { EventInfo, Ticket } from '../types';

export default function ListResaleModal({ ticket, event, onClose }: { ticket: Ticket; event: EventInfo; onClose: () => void }) {
  const { address, signer } = useWallet();
  const toast = useToast();
  const { refresh } = useData();
  const ctx = { signer, address: address! };

  const [cap, setCap] = useState<number | null>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Reads capPercent from the contract. Falls back to the indexed value if the read fails.
  useEffect(() => {
    chain.getCapPercent(ctx, event.id).then(setCap).catch(() => setCap(event.capPercent));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event.id]);

  const max = cap === null ? null : maxResalePrice(event.faceValue, cap);

  let priceWei: bigint | null = null;
  let inputError = '';
  if (value.trim() && max !== null) {
    try {
      const p = parseEther(value.trim());
      if (p <= 0n) inputError = 'Enter a price above 0.';
      else if (p > max) inputError = `Price is above the cap of ${fmtEth(max)} ETH.`;
      else priceWei = p;
    } catch {
      inputError = 'Enter a valid ETH amount, for example 0.05.';
    }
  }

  const royalty = priceWei === null ? null : (priceWei * BigInt(event.royaltyPercent)) / 100n;
  const canSubmit = priceWei !== null && !busy;

  async function submit() {
    if (priceWei === null) return;
    setBusy(true);
    setSubmitError(null);
    try {
      const hash = await chain.listForResale(ctx, ticket.id, priceWei);
      toast.push('success', `Ticket #${ticket.id} is listed.`, hash);
      refresh();
      onClose();
    } catch (e) {
      setSubmitError(parseError(e));
      setBusy(false);
    }
  }

  return (
    <Modal title="List for resale" onClose={onClose}>
      <p className="text-sm text-mute">
        {event.name}, ticket #{ticket.id}
      </p>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-lg bg-paper p-3">
          <dt className="text-mute">Face value</dt>
          <dd className="font-bold">{fmtEth(event.faceValue)} ETH</dd>
        </div>
        <div className="rounded-lg bg-cap-soft p-3">
          <dt className="text-cap">Maximum price</dt>
          <dd className="font-bold text-cap">{max === null ? 'Loading…' : `${fmtEth(max)} ETH`}</dd>
        </div>
      </dl>

      <label className="label mt-5" htmlFor="resale-price">
        Your price (ETH)
      </label>
      <input
        id="resale-price"
        className="input"
        inputMode="decimal"
        placeholder={max === null ? '' : fmtEth(max)}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-invalid={!!inputError}
        aria-describedby="resale-hint"
        disabled={busy || cap === null}
      />
      <p id="resale-hint" className={`mt-1 text-sm ${inputError ? 'text-bad' : 'text-mute'}`}>
        {inputError || `The organizer receives ${event.royaltyPercent}% of the resale price.`}
      </p>

      {priceWei !== null && royalty !== null && (
        <p className="mt-3 rounded-lg bg-ok-soft p-3 text-sm text-ok">
          You receive {fmtEth(priceWei - royalty)} ETH. Organizer royalty: {fmtEth(royalty)} ETH.
        </p>
      )}
      {submitError && (
        <p className="mt-3 rounded-lg bg-bad-soft p-3 text-sm text-bad" role="alert">
          {submitError}
        </p>
      )}

      <div className="mt-6 flex justify-end gap-3">
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={submit} disabled={!canSubmit}>
          {busy ? 'Waiting for wallet…' : 'List ticket'}
        </button>
      </div>
    </Modal>
  );
}
