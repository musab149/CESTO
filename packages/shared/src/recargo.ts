import { computeTaxBreakdown, recargoCents } from './tax';

/**
 * RECARGO DE EQUIVALENCIA on a basket, in cents — for screens that preview a
 * total before the server has priced it (order builders, edit screens,
 * checkout summaries).
 *
 * The API's own rule (lib/orderTotals recargoFor), on the same shared tax
 * helpers: the lines grouped by IVA rate, each rate's base backed out of what
 * it charges, the surcharge for that rate (0,5 / 1,4 / 5,2 % for 4 / 10 /
 * 21 %, none at 0 %) on that base — never on the IVA — and the delivery fee
 * as a line at the general rate. So what a screen previews is what the order
 * is charged, to the cent.
 */
export const DELIVERY_IVA_RATE = 21;

export function recargoOnCents(
  lines: ReadonlyArray<{ grossCents: number; rate_pct: number }>,
  deliveryFeeCents = 0,
): number {
  const b = computeTaxBreakdown([
    ...lines,
    ...(deliveryFeeCents > 0 ? [{ grossCents: deliveryFeeCents, rate_pct: DELIVERY_IVA_RATE }] : []),
  ]);
  return b.groups.reduce((s, g) => s + recargoCents(g.base_cents, g.rate_pct), 0);
}
