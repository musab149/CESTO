/**
 * Where to send the customer after checkout succeeds.
 *
 * POST /api/orders answers with either a single Order or
 * `{ parent_order, orders }`. The split shape is NOT multi-vendor-only:
 * MV_DRAFT_ORDERS defaults on, so a line where stock_quantity < quantity is
 * routed into its own draft sub-order and even a single-store cart comes back
 * split.
 *
 * Extracted from the checkout screen so the branch that broke the purchase
 * path — reading `.id` off the union and getting undefined — is a pure
 * function with tests rather than an expression buried in a submit handler.
 */
export function resolveCheckoutLanding(resp: unknown): string | null {
  if (!resp || typeof resp !== 'object') return null;

  const asSplit = resp as { orders?: unknown; parent_order?: { id?: unknown } };
  // Sniff the array, not just the key: `Order` itself carries an optional
  // `parent_order`, so keying on that alone would misread a sub-order as a
  // parent and send the customer to the wrong screen.
  const isSplit = Array.isArray(asSplit.orders);
  if (isSplit) {
    const parentId = asSplit.parent_order?.id;
    if (typeof parentId === 'string' && parentId) return parentId;
    // Split shape with no usable parent id: fall back to the first sub-order
    // rather than navigating nowhere. Better a partial view than /order/undefined.
    const first = (asSplit.orders as Array<{ id?: unknown }>)[0]?.id;
    return typeof first === 'string' && first ? first : null;
  }

  const id = (resp as { id?: unknown }).id;
  return typeof id === 'string' && id ? id : null;
}
