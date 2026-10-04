import { createContext, useContext } from 'react';
import type { useMapSync } from '../hooks/useMapSync';
import type { useKioskLink } from '../hooks/useKioskLink';

// Shared console data (live markers from broadcasts + kiosk link), mounted
// once by ConsoleLayout so every console page sees the same live state.
export interface ConsoleData extends ReturnType<typeof useMapSync> {
  kiosk: ReturnType<typeof useKioskLink>;
}

export const ConsoleDataContext = createContext<ConsoleData | null>(null);

export const useConsoleData = (): ConsoleData => {
  const ctx = useContext(ConsoleDataContext);
  if (!ctx) throw new Error('useConsoleData must be used within ConsoleDataContext.Provider');
  return ctx;
};
