import { useCartStore } from '@/stores/cartStore';
import type { BusinessSize } from '@grocery-app/shared';

/*
 * A size's price, stock and cart line (2026-10-29) — read by the catalogue
 * card and the product page. Kept out of components/catalogue so that file
 * exports only components (React Fast Refresh).
 */

/**
 * What they pay, and whether it is a price agreed with them. Only ever their
 * own price: a business is never shown the retail one (user, 2026-10-30).
 */
export function pricesOf(v: BusinessSize) {
  const pay = Number(v.price);
  // A price agreed with them: the wholesale price it came off is compare_at_price.
  const agreed = v.customer_discount != null && Number(v.customer_discount) > 0;
  return { pay, agreed };
}

export type StockState = 'in' | 'low' | 'out';
export const stockOf = (v: BusinessSize): StockState =>
  v.stock_quantity <= 0 ? 'out' : v.stock_quantity <= (v.low_stock_threshold ?? 10) ? 'low' : 'in';

/** A size's line in the cart, at most what is in stock. */
export function useLine(productId: string, v: BusinessSize | undefined) {
  const qty = useCartStore((s) => (v ? s.items.find((i) => i.variantId === v.id)?.quantity ?? 0 : 0));
  const addItem = useCartStore((s) => s.addItem);
  const updateQuantity = useCartStore((s) => s.updateQuantity);
  const removeItem = useCartStore((s) => s.removeItem);
  const max = v ? Math.max(0, v.stock_quantity) : 0;
  return {
    qty,
    max,
    add: () => { if (v && qty < max) addItem(productId, v.id, 1); },
    plus: () => { if (v && qty < max) updateQuantity(v.id, qty + 1); },
    minus: () => { if (!v) return; if (qty <= 1) removeItem(v.id); else updateQuantity(v.id, qty - 1); },
  };
}
