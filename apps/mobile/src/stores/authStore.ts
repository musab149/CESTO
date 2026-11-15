import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { authService, ApiError, setPricingModeHeader, type User } from '@grocery-app/shared';
import { useCartStore } from './cartStore';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  hydrating: boolean;
  hydrate: () => Promise<void>;
  login: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  register: (data: { name: string; email: string; phone: string; password: string }) => Promise<{ ok: boolean; error?: string }>;
  loginWithGoogle: (accessToken: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;
  forceLogout: () => void;
  setUser: (user: User | null) => void;
  /**
   * Set when the API refuses because this account has been blocked, holding
   * the reason an admin gave. Drives the sheet that explains why the session
   * ended — otherwise the app just stops working mid-shop. An empty string
   * means blocked with no reason recorded.
   */
  blockedNotice: string | null;
  setBlockedNotice: (reason: string | null) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,
      hydrating: true,

      // Every path that changes who is signed in must also set the pricing-mode
      // header: the API picks the price column from it, so a cold start that
      // skipped this served a business customer retail prices until they
      // happened to toggle the switch. Mirrors web's authStore.
      hydrate: async () => {
        try {
          const user = await authService.me();
          set({ user, isAuthenticated: true, hydrating: false });
          setPricingModeHeader(user.pricing_mode ?? 'retail');
        } catch {
          set({ user: null, isAuthenticated: false, hydrating: false });
          setPricingModeHeader('retail');
        }
      },

      login: async (email, password) => {
        try {
          await authService.loginEmail(email, password);
          const user = await authService.me();
          set({ user, isAuthenticated: true });
          setPricingModeHeader(user.pricing_mode ?? 'retail');
          // Returning customer — replace any guest items with the account's
          // real cart, so the basket left on the website is here too. Also
          // stops a shared phone handing one person's basket to the next.
          await useCartStore.getState().loadFromServer();
          return { ok: true };
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
          // account on this phone. Pushing it up unconditionally handed every
          // new account whatever had been sitting there. See claimGuestCart.
          await useCartStore.getState().claimGuestCart(user.id);
          return { ok: true };
        } catch (err) {
          return { ok: false, error: err instanceof ApiError ? err.message : (err instanceof Error ? err.message : 'Network error — is the API running?') };
        }
      },

      loginWithGoogle: async (accessToken) => {
        try {
          await authService.googleSignIn(accessToken);
          const user = await authService.me();
          set({ user, isAuthenticated: true });
          setPricingModeHeader(user.pricing_mode ?? 'retail');
          // Same as email login. A first-time Google user is rare enough to
          // accept re-adding guest items; discarding beats merging them into
          // an account that is not theirs.
          await useCartStore.getState().loadFromServer();
          return { ok: true };
        } catch (err) {
          return { ok: false, error: err instanceof ApiError ? err.message : (err instanceof Error ? err.message : 'Network error — is the API running?') };
        }
      },

      logout: async () => {
        await authService.logout();
        set({ user: null, isAuthenticated: false });
        setPricingModeHeader('retail');
        // Wipe the device cart. It persists to AsyncStorage under a single
        // key with no user in it, so leaving it behind means the next account
        // on this phone inherits the basket — and syncToServer would then
        // push it into that account at checkout.
        useCartStore.getState().clearCart();
      },

      blockedNotice: null,
      setBlockedNotice: (reason) => set({ blockedNotice: reason }),

      forceLogout: () => {
        set({ user: null, isAuthenticated: false });
        setPricingModeHeader('retail');
        // Same reason as logout — the session ended, the basket goes with it.
        useCartStore.getState().clearCart();
      },

      /** Patch the cached user after a mutation that returns a fresh copy,
       *  keeping the header in step. Used by the pricing-mode switch. */
      setUser: (user) => {
        set({ user, isAuthenticated: !!user });
        setPricingModeHeader(user?.pricing_mode ?? 'retail');
      },
    }),
    {
      name: 'cesto-auth',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ user: state.user, isAuthenticated: state.isAuthenticated }),
    },
  ),
);
