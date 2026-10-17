import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

// Bump `refreshKey` after any transaction so every page re-fetches its data.
const Ctx = createContext<{ refreshKey: number; refresh: () => void }>({ refreshKey: 0, refresh: () => {} });

export function DataProvider({ children }: { children: ReactNode }) {
  const [refreshKey, setKey] = useState(0);
  const refresh = useCallback(() => setKey((k) => k + 1), []);
  return <Ctx.Provider value={{ refreshKey, refresh }}>{children}</Ctx.Provider>;
}

export const useData = () => useContext(Ctx);
