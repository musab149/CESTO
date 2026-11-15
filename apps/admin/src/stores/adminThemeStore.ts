import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * The admin panel's light or dark (2026-10-28): the admin's choice, or the
 * device's — the rep panel's and the shop's way. Kept in this browser only.
 * The key is read again by index.html before the first paint, so dark never
 * flashes white on a reload.
 */
export type AdminThemeChoice = 'light' | 'dark' | 'system';

interface AdminThemeState {
  choice: AdminThemeChoice;
  setChoice: (choice: AdminThemeChoice) => void;
}

export const ADMIN_THEME_KEY = 'cesto-admin-theme';

export const useAdminThemeStore = create<AdminThemeState>()(
  persist(
    (set) => ({
      choice: 'system',
      setChoice: (choice) => set({ choice }),
    }),
    { name: ADMIN_THEME_KEY },
  ),
);
