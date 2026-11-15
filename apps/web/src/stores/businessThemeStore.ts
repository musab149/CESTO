import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * The business panel's light or dark (2026-10-29): the buyer's choice, or
 * their device's — the rep panel's way (stores/salesThemeStore), its own key
 * so a rep and a buyer on one computer keep their own. Read again by
 * index.html before the first paint.
 *
 * Light until they choose otherwise (user, 2026-10-31: "by default we need to
 * have light mode") — not their device's. The store only writes once they
 * pick, so a saved "Auto" is a choice they made and is kept.
 */
export type BusinessThemeChoice = 'light' | 'dark' | 'system';

interface BusinessThemeState {
  choice: BusinessThemeChoice;
  setChoice: (choice: BusinessThemeChoice) => void;
}

export const BUSINESS_THEME_KEY = 'cesto-business-theme';

export const useBusinessThemeStore = create<BusinessThemeState>()(
  persist(
    (set) => ({
      choice: 'light',
      setChoice: (choice) => set({ choice }),
    }),
    { name: BUSINESS_THEME_KEY },
  ),
);
