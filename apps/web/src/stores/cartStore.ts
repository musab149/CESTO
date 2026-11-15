import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { cartService } from '@grocery-app/shared';

export interface CartItem {
  productId: string;
  variantId: string;
  quantity: number;
}

/**
 * How long a guest basket is assumed to belong to whoever signs up next.
 *
 * The basket lives in localStorage with no owner, so without a limit it sits
 * there indefinitely and is handed to the next account created on this
 * browser — a stranger's nine items, or a developer's test data from three
 * days ago. Two hours is longer than a shopping session and far shorter than
 * "some other person, some other day".
 */
export const GUEST_CART_TTL_MS = 2 * 60 * 60 * 1000;

interface CartState {
  items: CartItem[];
  /** When the basket was last changed. Null for a basket restored from an
   *  older build, which is treated as stale — erring toward an empty cart. */
  lastTouchedAt: number | null;
  /** The account that has already taken these items. Stops one basket being
   *  offered to a second account on a shared browser. */
  claimedByUserId: string | null;
  /** `quantity` defaults to one; a product page adds what was chosen in ONE write. */
  addItem: (productId: string, variantId: string, quantity?: number) => void;
  removeItem: (variantId: string) => void;
  updateQuantity: (variantId: string, quantity: number) => void;
  clearCart: () => void;
  getItemCount: () => number;
  getQuantity: (variantId: string) => number;
  /** Push the local cart to the server (merges with whatever's already there).
   *  Returns the merged cart from the server and updates local state to match.
   *  Called on register (guest→new-account flow, preserves in-progress items)
   *  and right before checkout. Quietly no-ops if not authed. */
  syncToServer: () => Promise<void>;
  /** Replace the local cart with the account's server-side cart, discarding
   *  any guest items that were sitting in localStorage. Called on login (and
   *  Google sign-in) so a returning user sees their real saved cart, not a
   *  mishmash of guest-session and account items. Also protects against
   *  cross-user contamination on shared devices — a guest cart left on the
   *  browser doesn't leak into whoever logs in next.
   *  If the fetch fails, local state stays untouched (user still logged in,
   *  just sees the guest cart until they refresh). */
  loadFromServer: () => Promise<void>;
  /**
   * Decide what a newly created account inherits, and do it.
   *
   * Registration used to push the guest basket to the server unconditionally,
   * on the reasoning that someone who shops and then signs up should keep
   * what they picked. That is right, and it is why this still carries the
   * basket over — but only when the basket is plausibly THEIRS: touched
   * recently, and not already claimed by another account here.
   *
   * Anything else starts empty, which is what login has always done.
   */
  claimGuestCart: (userId: string) => Promise<void>;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      lastTouchedAt: null,
      claimedByUserId: null,
      // One set() however many units: the product page used to call this
      // once per unit, and each call re-saves the whole basket to storage —
      // adding 1,000 froze the page.
      addItem: (productId, variantId, quantity = 1) => {
        const n = Math.max(1, Math.floor(quantity));
        set((state) => {
          const existing = state.items.find((i) => i.variantId === variantId);
          if (existing) {
            return {
              items: state.items.map((i) => i.variantId === variantId ? { ...i, quantity: i.quantity + n } : i),
              lastTouchedAt: Date.now(),
            };
          }
          return {
            items: [...state.items, { productId, variantId, quantity: n }],
            lastTouchedAt: Date.now(),
          };
        });
      },
      removeItem: (variantId) => {
        set((state) => ({
          items: state.items.filter((i) => i.variantId !== variantId),
          lastTouchedAt: Date.now(),
        }));
      },
      updateQuantity: (variantId, quantity) => {
        if (quantity <= 0) {
          get().removeItem(variantId);
          return;
        }
        set((state) => ({
          items: state.items.map((i) => i.variantId === variantId ? { ...i, quantity } : i),
          lastTouchedAt: Date.now(),
        }));
      },
      clearCart: () => set({ items: [], lastTouchedAt: null }),
      getItemCount: () => get().items.reduce((sum, i) => sum + i.quantity, 0),
      getQuantity: (variantId) => get().items.find((i) => i.variantId === variantId)?.quantity ?? 0,
      /**
       * Push the local cart to the server, and LET A FAILURE THROUGH.
       *
       * It used to swallow everything, on the reasoning that "checkout will
       * surface a clear error if the cart is wrong" — and checkout does no
       * such thing. It places an order from whatever the SERVER cart holds,
       * which after a failed sync is the previous one. So a basket the server
       * refused (it was capped at 200 lines) was dropped silently and the
       * customer was charged for a stale cart, or told their cart was empty
       * while the screen in front of them was full.
       *
       * Every caller now either handles it or ignores it deliberately, which
       * is better than this function deciding for all of them. Local state is
       * left untouched by a failure, so nothing picked is lost.
       */
      syncToServer: async () => {
        const local = get().items;
        // REPLACE, not merge. The browser cart is what the user is looking
        // at, so it must win before we quote or place an order. /merge
        // resolves conflicts in favour of the server cart (correct for the
        // guest→account handoff, wrong here) which meant a quantity the
        // user had just changed got reverted to the older server value.
        const server = await cartService.replace(local);
        // Nothing changed — the usual case, since the server was just handed
        // this basket — keeps the SAME array. A new one, even an identical
        // one, redraws everything that reads the basket, and on a 1,000-line
        // checkout that held the page up for over a second right after
        // "Place order" (staging, 2026-10-21).
        const now = get().items;
        const want = new Map(now.map((i) => [i.variantId, i]));
        const same = server.items.length === now.length && server.items.every((i) => {
          const mine = want.get(i.variantId);
          return !!mine && mine.productId === i.productId && mine.quantity === i.quantity;
        });
        if (same) return;
        set({
          items: server.items.map((i) => ({
            productId: i.productId,
            variantId: i.variantId,
            quantity: i.quantity,
          })),
        });
      },
      claimGuestCart: async (userId) => {
        const { items, lastTouchedAt, claimedByUserId } = get();
        const fresh = lastTouchedAt !== null && Date.now() - lastTouchedAt <= GUEST_CART_TTL_MS;
        const unclaimed = claimedByUserId === null || claimedByUserId === userId;

        if (items.length > 0 && fresh && unclaimed) {
          // Their own in-progress shopping — save it to the new account.
          // Deliberately ignored: syncToServer now throws, and a cart that
          // did not carry over must not fail the registration it is riding
          // on. The items stay in local state either way, so the next sync
          // (on the checkout screen) tries again.
          try {
            await get().syncToServer();
          } catch { /* registration matters more than the carry-over */ }
          set({ claimedByUserId: userId });
          return;
        }

        // Stale, or already taken by someone else on this browser. Drop it
        // BEFORE reading the server, so a failed fetch cannot leave the
        // inherited items on screen.
        set({ items: [], lastTouchedAt: null, claimedByUserId: userId });
        await get().loadFromServer();
      },
      loadFromServer: async () => {
        try {
          // Fetch FIRST, then replace local. If the fetch fails we don't want
          // to have already-cleared local (would leave the user staring at an
          // empty cart with no data). set() below only fires on success.
          const server = await cartService.get();
          set({
            items: server.items.map((i) => ({
              productId: i.productId,
              variantId: i.variantId,
              quantity: i.quantity,
            })),
          });
        } catch {
          // 401 / network — keep local state as a soft fallback. Rare in
          // practice (login just succeeded, so the token is fresh).
        }
      },
    }),
    { name: 'grocery-cart' },
  ),
);
