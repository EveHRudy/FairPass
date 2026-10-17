import { useEffect, type ReactNode } from 'react';
import type { TicketStatus } from '../types';

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 py-10 text-mute" role="status">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-ink/20 border-t-brand" />
      {label}…
    </div>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-xl border border-bad/30 bg-bad-soft p-4 text-sm text-bad" role="alert">
      <p>{message}</p>
      {onRetry && (
        <button className="mt-2 font-semibold underline" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border-2 border-dashed border-ink/20 p-10 text-center">
      <h2 className="text-xl font-bold">{title}</h2>
      {hint && <p className="mx-auto mt-2 max-w-md text-mute">{hint}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

const badge: Record<TicketStatus, string> = {
  valid: 'bg-ok-soft text-ok',
  listed: 'bg-cap-soft text-cap',
  used: 'bg-ink/10 text-mute',
};
const badgeText: Record<TicketStatus, string> = { valid: 'Valid', listed: 'Listed for resale', used: 'Used' };

export function StatusBadge({ status }: { status: TicketStatus }) {
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${badge[status]}`}>{badgeText[status]}</span>;
}

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-8">
      <h1 className="text-3xl font-bold sm:text-4xl">{title}</h1>
      {children && <p className="mt-2 max-w-2xl text-mute">{children}</p>}
    </div>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/60 p-4 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-xl font-bold">{title}</h2>
          <button className="rounded p-1 text-mute hover:bg-ink/5" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
