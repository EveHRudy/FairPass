import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { EXPLORER_URL, USE_MOCK } from '../lib/config';

type Kind = 'success' | 'error' | 'info';
interface Toast { id: number; kind: Kind; text: string; hash?: string }

const Ctx = createContext<{ push: (kind: Kind, text: string, hash?: string) => void } | null>(null);

const tone: Record<Kind, string> = {
  success: 'border-ok/40 bg-ok-soft text-ok',
  error: 'border-bad/40 bg-bad-soft text-bad',
  info: 'border-brand/30 bg-brand-soft text-brand-dark',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((kind: Kind, text: string, hash?: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, text, hash }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 7000);
  }, []);

  return (
    <Ctx.Provider value={{ push }}>
      {children}
      <div className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-end gap-2" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`pointer-events-auto max-w-sm rounded-xl border px-4 py-3 text-sm font-medium shadow-lg ${tone[t.kind]}`}>
            {t.text}
            {t.hash && !USE_MOCK && (
              <a className="ml-2 underline" href={`${EXPLORER_URL}/tx/${t.hash}`} target="_blank" rel="noreferrer">
                View on Etherscan
              </a>
            )}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useToast must be used inside ToastProvider');
  return v;
}
