import { Prisma } from '@prisma/client';
import { recargoFor } from './orderTotals';

/**
 * A split purchase's own money columns, restated from what it holds now.
 *
 * Three places did this by hand, each a little differently — editing a part
 * (editOrder Pass 5), dropping a shop from a purchase (admin orders), and
 * setting the purchase's fee — and RECARGO DE EQUIVALENCIA (2026-11-04) is
 * charged at exactly this level: once, on the whole purchase, as its one
 * factura computes it. One function, so the three cannot drift.
 *
 *   subtotal = Σ live parts' subtotal
 *   recargo  = on every live part's lines + the purchase's fee, when the
 *              purchase is under the regime (else 0)
 *   total    = Σ live parts' total + delivery_fee_total + recargo
 *
 * The parts' totals, not their subtotals: today every part carries fee 0 and
 * recargo 0, so they are the same, but a part priced before the fee moved to
 * the purchase (2026-10-10) still adds up instead of losing its own fee.
 *
 * `fee` replaces the purchase's fee (the fee route); omitted, it is kept —
 * changing what is IN a purchase does not change what delivering it costs.
 * Returns null when the purchase has no live part left (the caller decides
 * what that means).
 */
export async function restatePurchaseTotals(
  tx: Prisma.TransactionClient,
  parentId: string,
  fee?: Prisma.Decimal,
) {
  const purchase = await tx.parentOrder.findUnique({
    where: { id: parentId },
    select: { delivery_fee_total: true, recargo_equivalencia: true },
  });
  if (!purchase) return null;
  const parts = await tx.order.findMany({
    where: { parent_order_id: parentId, deleted_at: null },
    select: { subtotal: true, total: true, items: { select: { line_total: true, tax_rate_pct: true } } },
  });
  if (parts.length === 0) return null;

  const deliveryFee = (fee ?? purchase.delivery_fee_total).toDecimalPlaces(2);
  const subtotal = parts.reduce((s, o) => s.plus(o.subtotal), new Prisma.Decimal(0));
  const recargo = purchase.recargo_equivalencia
    ? recargoFor(parts.flatMap((o) => o.items), deliveryFee)
    : new Prisma.Decimal(0);
  const total = parts.reduce((s, o) => s.plus(o.total), new Prisma.Decimal(0)).plus(deliveryFee).plus(recargo);

  return tx.parentOrder.update({
    where: { id: parentId },
    data: { subtotal, delivery_fee_total: deliveryFee, recargo, total },
  });
}
