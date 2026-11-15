// ─── Delivery fee — when it may be changed, and what it does ────
//
// The fee is a judgement about the parcel, not a consequence of the items,
// so it stays editable after the order exists: a rep prices it at the
// counter, a shop re-prices it when the load turns out heavier than it
// looked. Two routes offer that — PUT /api/admin/orders/:id/delivery-fee
// and PUT /api/partner/orders/:id/delivery-fee.
//
// WHAT IS SHARED HERE IS THE DECISION, NOT THE ROUTE. Both callers must
// refuse in exactly the same three situations, and three situations
// duplicated across two files is three chances for them to drift. What is
// deliberately NOT shared is the wording: a partner is told to ask us for a
// credit note, an admin is told to issue one, and each route keeps its own
// scoping and its own idea of who to notify afterwards. So this returns a
// machine-readable reason and lets the caller say it in its own voice.

import type { OrderStatus } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { recargoFor } from './orderTotals';
import { EDITABLE_STATUSES } from './editOrder';

export type DeliveryFeeBlocker =
  /** Outside the editable window. Re-pricing an order that has left the shop
   *  changes what was already charged for it. */
  | { kind: 'not_editable'; status: OrderStatus }
  /** An issued invoice is immutable and states this total. The correction is
   *  a credit note, not a new price. */
  | { kind: 'invoiced'; invoiceNumber: string }
  /** On a split purchase the fee belongs to the whole purchase and lives on
   *  the ParentOrder; every sub-order carries zero. Writing a fee onto one
   *  part would change a number nothing reads. */
  | { kind: 'split' };

export interface DeliveryFeeSubject {
  status: OrderStatus;
  parent_order_id: string | null;
  /** Pre-filtered to ISSUED invoices by the caller's query. A draft invoice
   *  must NOT block: it re-reads its order on load, so it follows a fee
   *  change rather than contradicting it. */
  invoices: { invoice_number: string | null }[];
}

/**
 * Why this order's delivery fee cannot be changed, or null if it can.
 *
 * Order matters and is deliberate: status first, because "this has already
 * been delivered" is the more fundamental objection and the one most likely
 * to be true; then the invoice, which is the legally load-bearing one; then
 * the split, which is the most confusing and worth reaching last.
 */
export function deliveryFeeBlocker(
  order: DeliveryFeeSubject,
  /**
   * `draftOk`: the caller has decided this draft may be changed — staff or the rep, on a
   * draft our team built (editOrder.ts isEditableDraft). A partner never
   * passes it.
   */
  opts: { draftOk?: boolean } = {},
): DeliveryFeeBlocker | null {
  const openDraft = opts.draftOk === true && order.status === 'draft';
  if (!EDITABLE_STATUSES.includes(order.status) && !openDraft) {
    return { kind: 'not_editable', status: order.status };
  }
  if (order.invoices.length > 0) {
    return { kind: 'invoiced', invoiceNumber: order.invoices[0].invoice_number ?? '' };
  }
  if (order.parent_order_id) {
    return { kind: 'split' };
  }
  return null;
}

/**
 * The fee and the total it feeds.
 *
 * The subtotal is the item rows and is never touched here — that is the
 * whole point of keeping this out of editOrder(), which owns the items and
 * deliberately carries the stored fee through untouched. The two halves of
 * an order's money move independently and each has exactly one owner.
 */
export function applyDeliveryFee(
  subtotal: Prisma.Decimal,
  fee: number | Prisma.Decimal,
  /**
   * The lines to charge recargo de equivalencia on (2026-11-04), when the
   * order is under the regime: the recargo follows the fee, which is part of
   * its base. Omitted, nothing is charged — and nothing is written, so a
   * part of a purchase keeps its 0 (the purchase is charged it).
   */
  recargoLines?: ReadonlyArray<{ line_total: Prisma.Decimal; tax_rate_pct?: number | null }> | null,
): { delivery_fee: Prisma.Decimal; total: Prisma.Decimal; recargo?: Prisma.Decimal } {
  // QUANTISE TO CENTS FIRST, then add. Both columns are Decimal(10,2), and
  // the request schema does not constrain decimal places, so a fee of 3.335
  // would otherwise be stored as 3.34 while the total kept 13.335 and was
  // rounded separately to 13.33 — an order whose own parts disagree by a
  // cent, found later by whoever reconciles it. Rounding once, here, means
  // the fee we store and the total we derive from it can never disagree.
  const raw = fee instanceof Prisma.Decimal ? fee : new Prisma.Decimal(fee);
  const d = raw.toDecimalPlaces(2);
  if (!recargoLines) return { delivery_fee: d, total: subtotal.plus(d) };
  const recargo = recargoFor(recargoLines, d);
  return { delivery_fee: d, recargo, total: subtotal.plus(d).plus(recargo) };
}

/**
 * What a standalone order's money columns become with a new fee, recargo
 * included (2026-11-04): the fee is part of the recargo's base, so an order
 * under the regime is re-charged it on its lines and the fee. Loads the lines
 * only when it has to. A part of a purchase never comes here (the fee routes
 * refuse it — the purchase's fee is restated by lib/purchaseTotals).
 */
export async function orderFeeData(
  db: Prisma.TransactionClient,
  order: { id: string; subtotal: Prisma.Decimal; recargo_equivalencia: boolean; parent_order_id: string | null },
  fee: number | Prisma.Decimal,
) {
  const lines = order.recargo_equivalencia && !order.parent_order_id
    ? await db.orderItem.findMany({ where: { order_id: order.id }, select: { line_total: true, tax_rate_pct: true } })
    : null;
  return applyDeliveryFee(order.subtotal, fee, lines);
}
