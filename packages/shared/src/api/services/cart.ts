import { api, ApiError } from '../client';
import type { Product, ProductVariant } from '../../types';

export interface CartItemDto {
  productId: string;
  variantId: string;
  quantity: number;
  variant?: Pick<ProductVariant, 'name_es' | 'name_en' | 'price' | 'stock_quantity'> | null;
  product?: (Pick<Product, 'id' | 'name_es' | 'name_en'> & { images?: { url: string }[] }) | null;
}

export interface CartPayload {
  items: CartItemDto[];
}

export const cartService = {
  get() {
    return api.get<CartPayload>('/api/cart');
  },
  add(productId: string, variantId: string, quantity: number) {
    return api.post<CartPayload>('/api/cart/items', { productId, variantId, quantity });
  },
  updateQuantity(variantId: string, quantity: number) {
    return api.put<CartPayload>(`/api/cart/items/${variantId}`, { quantity });
  },
  remove(variantId: string) {
    return api.delete<CartPayload>(`/api/cart/items/${variantId}`);
  },
  clear() {
    return api.delete<CartPayload>('/api/cart');
  },
  /** Guest→account handoff. Conflicts resolve in favour of the SERVER cart,
   *  so the account's own saved items survive. */
  merge(items: { productId: string; variantId: string; quantity: number }[]) {
    return api.post<CartPayload>('/api/cart/merge', { items });
  },
  /**
   * Replace the server cart with the client's. Use this whenever the CLIENT
   * is authoritative — chiefly the pre-checkout sync, where the cart the user
   * is looking at must win. Using merge() there silently reverted a quantity
   * the user had just changed.
   *
   * PATIENT, AND IT TRIES TWICE. This is the precondition for checkout: the
   * order is placed from the SERVER cart, so if this does not land, checkout
   * asks for an order against whatever was there before — usually nothing,
   * and the customer is told "Your cart is empty" while looking at a full
   * basket. That is what happened with a 74-line basket on 2026-10-10.
   *
   * It used to take the 10s default while checkout itself asks for 30s, so
   * the step that MUST succeed first gave up soonest — incoherent on any
   * cold or loaded API. A sleeping Render service took 92 SECONDS to answer
   * its first request that same day, which no client timeout can sit through;
   * but the second request after a wake is fast, and that is exactly what the
   * retry is for.
   *
   * Only transient failures are retried. A 4xx is the server's considered
   * answer — a basket over MAX_CART_LINES does not get better by being sent
   * again — so those throw immediately.
   */
  async replace(items: { productId: string; variantId: string; quantity: number }[]) {
    const send = () => api.put<CartPayload>('/api/cart', { items }, { timeoutMs: 30_000 });
    try {
      return await send();
    } catch (err) {
      const transient = err instanceof ApiError
        ? err.status === 408 || err.status >= 500
        // Not an ApiError at all: a network-level failure, which is the shape
        // a dropped connection takes.
        : true;
      if (!transient) throw err;
      return await send();
    }
  },
};
