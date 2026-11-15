import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { authService, ApiError, endsSession, setPricingModeHeader, type User } from '@grocery-app/shared';
import { useCartStore } from './cartStore';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  hydrating: boolean;
  /** Hydrate user from /me using the persisted token. Call once at app start. */
  hydrate: () => Promise<void>;
  login: (email: string, password: string) => Promise<{ ok: boolean; error?: string; must_change_password?: boolean }>;
  register: (input: { name: string; email: string; phone: string; password: string }) => Promise<{ ok: boolean; error?: string }>;
  loginWithGoogle: (idToken: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;
  forgotPassword: (email: string) => Promise<{ ok: boolean; error?: string; status?: number }>;
  /** Used by the API client when refresh fails — clears in-memory state without another network call. */
  forceLogout: () => void;
  /**
   * Set when the API refuses because this account has been blocked, holding
   * the reason an admin gave. Drives the dialog that explains why the session
   * ended — without it a blocked customer just watches the app stop working.
   * An empty string means blocked with no reason recorded.
   */
  blockedNotice: string | null;
  setBlockedNotice: (reason: string | null) => void;
}

/**
 * When "who am I?" fails for a reason that says nothing about the session —
 * offline, slow, a server fault — it is asked again after these delays.
 */
const HYDRATE_RETRY_DELAYS_MS = [5_000, 15_000, 45_000];
let hydrateRetries = 0;
let hydrateTimer: ReturnType<typeof setTimeout> | null = null;

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      isAuthenticated: false,
      hydrating: true,

      hydrate: async () => {
        if (hydrateTimer) { clearTimeout(hydrateTimer); hydrateTimer = null; }
        try {
          const user = await authService.me();
          hydrateRetries = 0;
          set({ user, isAuthenticated: true, hydrating: false });
          setPricingModeHeader(user.pricing_mode ?? 'retail');
        } catch (err) {
          if (endsSession(err)) {
            hydrateRetries = 0;
            set({ user: null, isAuthenticated: false, hydrating: false });
            setPricingModeHeader('retail');
            return;
          }
          // Could not ask. Any failure used to mean "signed out", so an API
          // hiccup at page load put "Sign in" in the header of a shopper who
          // was signed in all along. Keep who they were last time — the token
          // is still stored and almost certainly fine — and ask again soon.
          set({ hydrating: false });
          setPricingModeHeader(get().user?.pricing_mode ?? 'retail');
          const delay = HYDRATE_RETRY_DELAYS_MS[hydrateRetries];
          if (delay !== undefined) {
            hydrateRetries += 1;
            hydrateTimer = setTimeout(() => { void get().hydrate(); }, delay);
          }
        }
      },

      login: async (email, password) => {
        try {
          const tokens = await authService.loginEmail(email, password);
          const user = await authService.me();
          set({ user, isAuthenticated: true });
          setPricingModeHeader(user.pricing_mode ?? 'retail');
          // Returning user — replace any guest-cart items (from an unrelated
          // browsing session or a previous guest) with the account's real
          // server cart. Prevents cross-user contamination on shared devices
          // and matches the "log in, see MY cart" mental model.
          await useCartStore.getState().loadFromServer();
          return { ok: true, must_change_password: tokens.must_change_password === true };
        } catch (err) {
          return { ok: false, error: err instanceof ApiError ? err.message : (err instanceof Error ? err.message : 'Network error — is the API running?') };
        }
      },

      register: async ({ name, email, password }) => {
        try {
          await authService.registerEmail(name, email, password);
          const user = await authService.me();
          set({ user, isAuthenticated: true });
          setPricingModeHeader(user.pricing_mode ?? 'retail');
          // Carry the guest basket over only when it is plausibly this
          // person's: touched recently, and not already claimed by another
          // account on this browser. An unconditional sync handed every new
          // account whatever had been sitting in localStorage — a stranger's
          // basket on a shared device, or stale test data. See claimGuestCart.
          await useCartStore.getState().claimGuestCart(user.id);
          return { ok: true };
        } catch (err) {
          return { ok: false, error: err instanceof ApiError ? err.message : (err instanceof Error ? err.message : 'Network error — is the API running?') };
        }
      },

      loginWithGoogle: async (idToken) => {
        try {
          await authService.googleSignIn(idToken);
          const user = await authService.me();
          set({ user, isAuthenticated: true });
          setPricingModeHeader(user.pricing_mode ?? 'retail');
          // Same as email login — treat as returning user. New-Google-user is
          // rare enough to accept that they'd have to re-add guest items;
          // discarding is safer than merging into someone else's account.
          await useCartStore.getState().loadFromServer();
          return { ok: true };
        } catch (err) {
          return { ok: false, error: err instanceof ApiError ? err.message : (err instanceof Error ? err.message : 'Network error — is the API running?') };
        }
      },

      forgotPassword: async (email) => {
        try { await authService.forgotPassword(email); return { ok: true }; }
        catch (err) {
          if (err instanceof ApiError) return { ok: false, error: err.message, status: err.status };
          return { ok: false, error: err instanceof Error ? err.message : 'Network error — is the API running?' };
        }
      },

      logout: async () => {
        // Tear down the browser push subscription BEFORE clearing the
        // access token — otherwise the /web-unsubscribe call 401s and we
        // leak a dead subscription in the DB.
        try {
          const { unsubscribeFromPush } = await import('@/lib/webPush');
          await unsubscribeFromPush();
        } catch {
          /* best-effort — don't block logout if the module fails to load */
        }
        await authService.logout();
        set({ user: null, isAuthenticated: false });
        setPricingModeHeader('retail');
        // Wipe the browser-shared cart. Zustand persists `grocery-cart` to
        // localStorage with no per-user key, so leaving it around means the
        // next account that logs in / registers on this device inherits
        // whatever was in it via syncToServer's merge.
        useCartStore.getState().clearCart();
      },

      blockedNotice: null,
      setBlockedNotice: (reason) => set({ blockedNotice: reason }),

      forceLogout: () => {
        set({ user: null, isAuthenticated: false });
        setPricingModeHeader('retail');
        // Same reason as logout — session ended, cart must not survive.
        useCartStore.getState().clearCart();
      },
    }),
    {
      name: 'cesto-auth',
      partialize: (state) => ({ user: state.user, isAuthenticated: state.isAuthenticated }),
    },
  ),
);
