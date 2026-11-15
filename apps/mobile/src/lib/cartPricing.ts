/** The mutable slice of a cart line — everything that drifts while an item
 *  sits in a persisted cart. */
export interface FreshVariant {
  price: number;
  compare_at_price: number | null;
  maxStock: number;
}

/** Only the fields reconciliation reads or writes. Keeps this testable
 *  without dragging the whole CartItem (and AsyncStorage) in. */
export interface PriceableLine {
  variantId: string;
  price: number;
  compare_at_price: number | null;
  maxStock: number;
  quantity: number;
}

/**
 * Reconcile a persisted cart against live catalogue figures.
 *
 * Extracted from cartStore so the fiddly parts are testable: this cart keeps a
 * full snapshot per line (so it works offline), which means a basket left
 * overnight renders last week's prices and then disagrees with the checkout
 * quote.
 *
 * Returns `null` when nothing moved. The caller runs this from an effect on
 * every catalogue refetch, so handing back a fresh array unconditionally would
 * loop forever.
 */
export function reconcileCartPrices<T extends PriceableLine>(
  items: T[],
  fresh: Record<string, FreshVariant>,
): T[] | null {
  let changed = false;

  const next = items.map((item) => {
    const f = fresh[item.variantId];
    // Absent means the product is gone or inactive. Leave the line alone: the
    // checkout quote already reports that per line as unavailable, and
    // blanking the price here would turn a clear message into a €0.00.
    if (!f) return item;

    const same =
      f.price === item.price &&
      f.compare_at_price === item.compare_at_price &&
      f.maxStock === item.maxStock;
    if (same) return item;

    changed = true;
    return {
      ...item,
      price: f.price,
      compare_at_price: f.compare_at_price,
      maxStock: f.maxStock,
      // Stock can fall below what is already in the basket. Clamp rather than
      // let checkout reject the whole cart — but never to zero, which would
      // silently empty a line the customer deliberately chose.
      quantity: f.maxStock > 0 ? Math.min(item.quantity, f.maxStock) : item.quantity,
    };
  });

  return changed ? next : null;
}
