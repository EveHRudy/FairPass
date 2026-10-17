import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Modal } from './ui';
import { useWallet } from '../context/WalletContext';
import { createEntryQR, type EntryQR } from '../lib/qr';
import { nowSec, parseError } from '../lib/format';
import type { EventInfo, Ticket } from '../types';

/**
 * Shows the signed entry QR. The wallet signs only when the user presses the button,
 * so there is never a surprise signature popup. The QR expires (about 30 seconds) and can be regenerated.
 */
export default function QRModal({ ticket, event, onClose }: { ticket: Ticket; event: EventInfo; onClose: () => void }) {
  const { address, signer } = useWallet();
  const [qr, setQr] = useState<EntryQR | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    if (!qr) return;
    const tick = () => setSecondsLeft(Math.max(0, qr.expiresAt - nowSec()));
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [qr]);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      setQr(await createEntryQR({ signer, address: address! }, ticket.id));
    } catch (e) {
      setError(parseError(e));
    } finally {
      setBusy(false);
    }
  }

  const expired = qr !== null && secondsLeft <= 0;

  return (
    <Modal title="Entry QR" onClose={onClose}>
      <p className="text-sm text-mute">
        {event.name}, ticket #{ticket.id}
      </p>

      <div className="mt-4 flex flex-col items-center">
        {qr ? (
          <div className="relative rounded-xl border border-ink/10 bg-white p-4">
            <QRCodeSVG value={qr.payload} size={220} level="M" />
            {expired && (
              <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-white/90 text-center text-sm font-semibold text-bad">
                Expired. Generate a new QR.
              </div>
            )}
          </div>
        ) : (
          <div className="flex h-[252px] w-[252px] items-center justify-center rounded-xl border-2 border-dashed border-ink/20 p-6 text-center text-sm text-mute">
            Your wallet signs a one-time challenge to prove you own this ticket.
          </div>
        )}

        {qr && !expired && <p className="mt-3 text-sm font-semibold text-ok">Valid for {secondsLeft} more seconds</p>}
        {error && (
          <p className="mt-3 w-full rounded-lg bg-bad-soft p-3 text-sm text-bad" role="alert">
            {error}
          </p>
        )}
      </div>

      <div className="mt-6 flex justify-end gap-3">
        <button className="btn btn-ghost" onClick={onClose}>
          Close
        </button>
        <button className="btn btn-primary" onClick={generate} disabled={busy || (qr !== null && !expired)}>
          {busy ? 'Waiting for wallet…' : qr ? 'Generate new QR' : 'Sign and show QR'}
        </button>
      </div>
    </Modal>
  );
}
