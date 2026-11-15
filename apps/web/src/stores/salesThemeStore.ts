import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * The rep panel's light or dark (2026-10-28): the rep's choice, or the
 * device's. Kept in this browser only — a convenience, like the language.
 * The key is read again by index.html before the first paint, so a rep who
 * chose dark never sees the panel flash white on a reload.
 */
export type SalesThemeChoice = 'light' | 'dark' | 'system';

interface SalesThemeState {
  choice: SalesThemeChoice;
  setChoice: (choice: SalesThemeChoice) => void;
}

export const SALES_THEME_KEY = 'cesto-sales-theme';

export const useSalesThemeStore = create<SalesThemeState>()(
  persist(
    (set) => ({
      choice: 'system',
      setChoice: (choice) => set({ choice }),
    }),
    { name: SALES_THEME_KEY },
  ),
);
