import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * The shop's light or dark (2026-10-28): the shopper's choice, or the
 * device's — the rep panel's way (stores/salesThemeStore). Kept in this
 * browser only, like the language. The key is read again by index.html
 * before the first paint, so a shopper who chose dark never sees a white
 * flash on a reload.
 */
export type ShopThemeChoice = 'light' | 'dark' | 'system';

interface ShopThemeState {
  choice: ShopThemeChoice;
  setChoice: (choice: ShopThemeChoice) => void;
}

export const SHOP_THEME_KEY = 'cesto-theme';

export const useShopThemeStore = create<ShopThemeState>()(
  persist(
    (set) => ({
      choice: 'system',
      setChoice: (choice) => set({ choice }),
    }),
    { name: SHOP_THEME_KEY },
  ),
);
