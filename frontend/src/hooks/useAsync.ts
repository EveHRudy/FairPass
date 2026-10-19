import { useEffect, useState } from 'react';
import { useData } from '../context/DataContext';
import { parseError } from '../lib/format';

/** Runs `fn` whenever `deps` change or a transaction triggers a global refresh. Keeps old data while reloading. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const { refreshKey } = useData();
  const [local, setLocal] = useState(0);
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({
    data: null,
    error: null,
    loading: true,
  });

  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn()
      .then((data) => alive && setState({ data, error: null, loading: false }))
      .catch((e) => alive && setState({ data: null, error: parseError(e), loading: false }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, refreshKey, local]);

  return { ...state, reload: () => setLocal((n) => n + 1) };
}
