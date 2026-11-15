/**
 * A product size from the Catálogo, on its way into a new order.
 *
 * Carried in the URL — `?add=<size>&product=<product>` — because the order
 * screen asks for the client first (every price depends on them), and that
 * question can itself go through "new client". Query parameters survive both
 * hops and a reload; component state survives neither.
 *
 * Only ids travel. The order screen reads the product again once it knows the
 * client, so the line goes in at the price THAT client pays — what the
 * Catálogo showed was retail and wholesale side by side, for nobody.
 */
export interface PendingAdd {
  variantId: string;
  productId: string;
}

export function pendingAddOf(params: URLSearchParams): PendingAdd | null {
  const variantId = params.get('add');
  const productId = params.get('product');
  return variantId && productId ? { variantId, productId } : null;
}

/** `add=…&product=…`, or '' with nothing pending. */
export function pendingAddQuery(p: PendingAdd | null): string {
  return p ? new URLSearchParams({ add: p.variantId, product: p.productId }).toString() : '';
}

/** The order screen, starting with this size in the basket. */
export function newOrderWith(p: PendingAdd): string {
  return `/sales/orders/new?${pendingAddQuery(p)}`;
}
