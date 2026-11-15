import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { cartService } from '@grocery-app/shared';
import { reconcileCartPrices, type FreshVariant } from '../lib/cartPricing';

export type { FreshVariant };

export interface CartItem {
  productId: string;
  variantId: string;
  name_es: string;
  name_en: string;
  variantName_es: string;
  variantName_en: string;
  price: number;
  compare_at_price: number | null;
  image: string;
  quantity: number;
  maxStock: number;
}

/**
 * How long a guest basket is assumed to belong to whoever signs up next.
 *
 * The basket is persisted with no owner, so without a limit it survives
 * indefinitely on the device and is handed to the next account created on it.
 * Two hours is longer than a shopping session and far shorter than "someone
 * else, another day". Matches apps/web's cart store.
 */
export const GUEST_CART_TTL_MS = 2 * 60 * 60 * 1000;

interface CartState {
  items: CartItem[];
  /** When the basket was last changed. Null for one restored from a build
   *  that predates this, which counts as stale. */
  lastTouchedAt: number | null;
  /** The account that has already taken these items. */
  claimedByUserId: string | null;
  addItem: (item: Omit<CartItem, 'quantity'>) => void;
  removeItem: (variantId: string) => void;
  updateQuantity: (variantId: string, quantity: number) => void;
  clearCart: () => void;
  getItemCount: () => number;
  getSubtotal: () => number;
  getQuantity: (variantId: string) => number;
  /** Push the local cart to the server so the checkout endpoint sees the items
   *  collected on the device. Quietly no-ops on auth/network errors. */
  syncToServer: () => Promise<void>;
  /** Pull the signed-in account's cart down, replacing whatever is on the
   *  device. Called on login — see the implementation for why. */
  loadFromServer: () => Promise<void>;
  /**
   * What a newly created account inherits. Registration used to push the
   * guest basket up unconditionally, which handed every new account whatever
   * had been sitting on the phone. It now carries over only a basket that is
   * plausibly the same person's — recent, and not already claimed here.
   */
  claimGuestCart: (userId: string) => Promise<void>;
  /** Overwrite the persisted price/stock snapshot with what the catalogue says
   *  right now. See the implementation for why this exists. */
  syncPrices: (fresh: Record<string, FreshVariant>) => void;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      lastTouchedAt: null,
      claimedByUserId: null,

      addItem: (item) => {
        const existing = get().items.find((i) => i.variantId === item.variantId);
        if (existing) {
          if (existing.quantity < existing.maxStock) {
            set({
              items: get().items.map((i) =>
                i.variantId === item.variantId ? { ...i, quantity: i.quantity + 1 } : i,
              ),
              lastTouchedAt: Date.now(),
            });
          }
        } else {
          set({ items: [...get().items, { ...item, quantity: 1 }], lastTouchedAt: Date.now() });
        }
      },

      removeItem: (variantId) => {
        set({ items: get().items.filter((i) => i.variantId !== variantId), lastTouchedAt: Date.now() });
      },

      updateQuantity: (variantId, quantity) => {
        if (quantity <= 0) {
          set({ items: get().items.filter((i) => i.variantId !== variantId), lastTouchedAt: Date.now() });
        } else {
          set({
            items: get().items.map((i) =>
              i.variantId === variantId ? { ...i, quantity: Math.min(quantity, i.maxStock) } : i,
            ),
            lastTouchedAt: Date.now(),
          });
        }
      },

      clearCart: () => set({ items: [], lastTouchedAt: null }),

      claimGuestCart: async (userId) => {
        const { items, lastTouchedAt, claimedByUserId } = get();
        const fresh = lastTouchedAt !== null && Date.now() - lastTouchedAt <= GUEST_CART_TTL_MS;
        const unclaimed = claimedByUserId === null || claimedByUserId === userId;

        if (items.length > 0 && fresh && unclaimed) {
          await get().syncToServer();
          set({ claimedByUserId: userId });
          return;
        }

        // Cleared BEFORE the fetch, so a failed read cannot leave the
        // inherited items on screen.
        set({ items: [], lastTouchedAt: null, claimedByUserId: userId });
        await get().loadFromServer();
      },

      getItemCount: () => get().items.reduce((sum, i) => sum + i.quantity, 0),

      getSubtotal: () => get().items.reduce((sum, i) => sum + i.price * i.quantity, 0),

      getQuantity: (variantId) => get().items.find((i) => i.variantId === variantId)?.quantity ?? 0,

      /**
       * This cart persists a full snapshot of each line — name, image, price —
       * to AsyncStorage, unlike the web cart, which keeps ids and resolves the
       * rest at render. That makes it work offline, but it also means a cart
       * left overnight renders last week's prices, and the totals disagree with
       * the checkout quote the moment the customer gets there.
       *
       * The cart screen fetches its products by id and hands the live figures
       * back here, so the fix lands on the persisted state rather than only on
       * one screen's render — the tab-bar badge, the checkout fallback subtotal
       * and any future reader all see the corrected numbers.
       *
       * Lines missing from `fresh` are left alone on purpose: absence means the
       * product is gone or inactive, and the checkout quote already reports
       * that per line as an unavailable issue. Blanking the price here would
       * just turn a clear message into a confusing €0.00.
       */
      syncPrices: (fresh) => {
        const next = reconcileCartPrices(get().items, fresh);
        // null means nothing moved. This runs from an effect on every
        // catalogue refetch, so a set() here regardless would loop.
        if (next) set({ items: next });
      },

      /**
       * Replace the device cart with the account's own.
       *
       * Called when someone logs in. Two reasons, both of which mobile was
       * missing entirely: a returning customer expects the basket they left on
       * the website, and — more seriously — this cart persists to AsyncStorage
       * under one key with no user in it, so without this the next person to
       * log in on a shared phone inherits the previous one's basket and
       * syncToServer then pushes it into THEIR account at checkout.
       *
       * Fetches before it writes: if the request fails, local state is left
       * alone rather than cleared, so a network blip cannot empty a basket.
       *
       * compare_at_price is not in the cart payload, so a discount shows as
       * absent until the cart screen re-prices against the catalogue. That is
       * the same path that already corrects stale prices.
       */
      loadFromServer: async () => {
        try {
          const server = await cartService.get();
          set({
            items: server.items.map((i) => ({
              productId: i.productId,
              variantId: i.variantId,
              quantity: i.quantity,
              name_es: i.product?.name_es ?? '',
              name_en: i.product?.name_en ?? '',
              variantName_es: i.variant?.name_es ?? '',
              variantName_en: i.variant?.name_en ?? '',
              price: Number(i.variant?.price ?? 0),
              compare_at_price: null,
              image: i.product?.images?.[0]?.url ?? '',
              maxStock: i.variant?.stock_quantity ?? 0,
            })),
          });
        } catch {
          // 401 or network. Keep what is on the device — rare in practice,
          // since a login has just succeeded and the token is fresh.
        }
      },

      syncToServer: async () => {
        try {
          const local = get().items.map((i) => ({
            productId: i.productId,
            variantId: i.variantId,
            quantity: i.quantity,
          }));
          // REPLACE, not merge — same reasoning as the web store: the
          // device's cart is what the user is looking at, so it must win
          // before checkout. /merge lets the server cart win on conflicts,
          // which is only correct for the guest→account handoff.
          await cartService.replace(local);
        } catch {
          // 401 or network — let checkout surface the error.
        }
      },
    }),
    {
      name: 'grocery-cart',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
