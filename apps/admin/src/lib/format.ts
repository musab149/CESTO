/**
 * Money, the way the order screens print it: `12,50 €`.
 *
 * Moved here verbatim from EditOrderModal, which is now two files and needed
 * one copy rather than two.
 *
 * Deliberately NOT merged with the `formatCurrency` in StoreProductsList or
 * CustomerDetailPage. They look like the same function and are not: one
 * returns a bare number because its callers prepend their own `€`, and the
 * other accepts null. Folding three different behaviours into one name would
 * change what two unrelated screens render, which is not what an extraction
 * is for.
 */
export function formatCurrency(n: number): string {
  return n.toFixed(2).replace('.', ',') + ' \u20AC';
}
