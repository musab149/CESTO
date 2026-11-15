import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { adminAuth, ApiError, endsSession, type AdminUser } from '@grocery-app/shared';

interface AuthState {
  user: AdminUser | null;
  isAuthenticated: boolean;
  hydrating: boolean;
  hydrate: () => Promise<void>;
  login: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;
  forceLogout: () => void;
  /** Their own password. The error is kept whole: its code says which field was wrong. */
  changePassword: (current: string, next: string) => Promise<{ ok: boolean; error?: unknown }>;
}

/**
 * When "who am I?" fails for a reason that says nothing about the session —
 * offline, slow, a server fault — it is asked again after these delays.
 */
const HYDRATE_RETRY_DELAYS_MS = [5_000, 15_000, 45_000];
let hydrateRetries = 0;
let hydrateTimer: ReturnType<typeof setTimeout> | null = null;

export const useAdminAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      isAuthenticated: false,
      hydrating: true,

      hydrate: async () => {
        if (hydrateTimer) { clearTimeout(hydrateTimer); hydrateTimer = null; }
        try {
          const user = await adminAuth.me();
          hydrateRetries = 0;
          set({ user, isAuthenticated: true, hydrating: false });
        } catch (err) {
          if (endsSession(err)) {
            hydrateRetries = 0;
            set({ user: null, isAuthenticated: false, hydrating: false });
            return;
          }
          // Could not ask — offline, slow, or the API restarting. That used
          // to sign the admin out on the spot. Keep the session they had and
          // ask again soon; the pages say for themselves what failed to load.
          set({ hydrating: false });
          const delay = HYDRATE_RETRY_DELAYS_MS[hydrateRetries];
          if (delay !== undefined) {
            hydrateRetries += 1;
            hydrateTimer = setTimeout(() => { void get().hydrate(); }, delay);
          }
        }
      },

      login: async (email, password) => {
        try {
          const res = await adminAuth.login(email, password);
          set({ user: res.admin, isAuthenticated: true });
          return { ok: true };
        } catch (err) {
          return { ok: false, error: err instanceof ApiError ? err.message : (err instanceof Error ? err.message : 'Network error — is the API running?') };
        }
      },

      logout: async () => {
        // Best-effort: forget this browser's push subscription so the next
        // admin on the same machine doesn't inherit the previous one's
        // notifications. Ignore errors — the API-side row will get pruned
        // later either way (410 on send).
        try {
          const { unsubscribeFromPush } = await import('@/lib/webPush');
          await unsubscribeFromPush();
        } catch { /* swallow */ }
        await adminAuth.logout();
        set({ user: null, isAuthenticated: false });
      },

      forceLogout: () => set({ user: null, isAuthenticated: false }),

      changePassword: async (current, next) => {
        try {
          const res = await adminAuth.changePassword(current, next);
          set({ user: res.admin, isAuthenticated: true });
          return { ok: true };
        } catch (err) {
          return { ok: false, error: err };
        }
      },
    }),
    {
      name: 'cesto-admin-auth',
      partialize: (state) => ({ user: state.user, isAuthenticated: state.isAuthenticated }),
    },
  ),
);
