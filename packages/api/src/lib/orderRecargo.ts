import { Prisma, type OrderStatus } from '@prisma/client';
import prisma from './prisma';
import { deliveryFeeBlocker } from './deliveryFee';
import { isEditableDraft, EDITABLE_STATUSES } from './editOrder';
import { deriveParentOrderStatus } from './parentOrder';
import { recargoFor } from './orderTotals';
import { restatePurchaseTotals } from './purchaseTotals';

/**
 * Recargo de equivalencia on an order ALREADY PLACED (2026-11-04).
 *
 * An order copies the customer's regime when it is placed, so one placed
 * before the office turned the customer's switch on carries none — the user:
 * "when a user placed an order it landed in admin and then we turn on the
 * recargo, that already placed order will not include it … it should be
 * added to that order in a better way". So the office can add it (or take it
 * off) on the order itself, and the order's total, bill, factura and
 * emails then all agree — rather than a factura stating a recargo the order
 * never charged.
 *
 * WHEN: exactly when the delivery fee may still change (deliveryFeeBlocker) —
 * an order pending, confirmed or preparing, or a draft our team built, with
 * no factura issued. After that the figures are someone's record.
 *
 * WHERE: a split purchase is charged it once, on the whole, so a part or the
 * purchase's own id changes the whole purchase.
 */

export type RecargoChange =
  | { status: 'ok'; kind: 'order' | 'purchase'; id: string; recargo: Prisma.Decimal; total: Prisma.Decimal }
  | { status: 'not_found' }
  | { status: 'not_editable'; orderStatus: OrderStatus }
  | { status: 'invoiced'; invoiceNumber: string };

const ISSUED_FACTURA = { where: { status: 'issued' as const, kind: 'invoice' as const }, select: { invoice_number: true } };

async function setPurchaseRecargo(parentId: string, on: boolean): Promise<RecargoChange> {
  const parent = await prisma.parentOrder.findUnique({
    where: { id: parentId },
    select: {
      id: true,
      sub_orders: { where: { deleted_at: null }, select: { status: true } },
      invoices: ISSUED_FACTURA,
    },
  });
  if (!parent || parent.sub_orders.length === 0) return { status: 'not_found' };
  const blocked = deliveryFeeBlocker({
    status: deriveParentOrderStatus(parent.sub_orders.map((o) => o.status)),
    parent_order_id: null,
    invoices: parent.invoices,
  });
  if (blocked?.kind === 'not_editable') return { status: 'not_editable', orderStatus: blocked.status };
  if (blocked?.kind === 'invoiced') return { status: 'invoiced', invoiceNumber: blocked.invoiceNumber };

  const restated = await prisma.$transaction(async (tx) => {
    await tx.parentOrder.update({ where: { id: parent.id }, data: { recargo_equivalencia: on } });
    // The parts follow the purchase's regime (and carry no recargo of their own).
    await tx.order.updateMany({ where: { parent_order_id: parent.id }, data: { recargo_equivalencia: on } });
    return restatePurchaseTotals(tx, parent.id);
  });
  if (!restated) return { status: 'not_found' };
  return { status: 'ok', kind: 'purchase', id: restated.id, recargo: restated.recargo, total: restated.total };
}

/** Turn recargo on or off for one order — or, for a part of a split purchase or a purchase's id, the whole purchase. */
export async function setOrderRecargo(id: string, on: boolean): Promise<RecargoChange> {
  const order = await prisma.order.findFirst({
    where: { id, deleted_at: null },
    select: {
      id: true, status: true, subtotal: true, delivery_fee: true, parent_order_id: true,
      created_by_admin_id: true, created_by_sales_rep_id: true, rashan_subscription_id: true,
      invoices: ISSUED_FACTURA,
      items: { select: { line_total: true, tax_rate_pct: true } },
    },
  });
  if (!order) return setPurchaseRecargo(id, on);
  if (order.parent_order_id) return setPurchaseRecargo(order.parent_order_id, on);

  const blocked = deliveryFeeBlocker(order, { draftOk: isEditableDraft(order) });
  if (blocked?.kind === 'not_editable') return { status: 'not_editable', orderStatus: blocked.status };
  if (blocked?.kind === 'invoiced') return { status: 'invoiced', invoiceNumber: blocked.invoiceNumber };

  const recargo = on ? recargoFor(order.items, order.delivery_fee) : new Prisma.Decimal(0);
  const updated = await prisma.order.update({
    where: { id: order.id },
    data: { recargo_equivalencia: on, recargo, total: order.subtotal.plus(order.delivery_fee).plus(recargo) },
    select: { id: true, recargo: true, total: true },
  });
  return { status: 'ok', kind: 'order', id: updated.id, recargo: updated.recargo, total: updated.total };
}

/**
 * The customer's switch, carried onto their OPEN orders — what the office
 * picks when it turns the regime on (or off) for someone who already has
 * orders on the way. Open = still changeable (as above) and not already
 * on the regime asked for; each standalone order and each purchase once.
 * Returns how many were changed and how many could not be (already
 * invoiced, a race) — never an error for the switch itself.
 */
export async function applyRecargoToOpenOrders(userId: string, on: boolean): Promise<{ changed: number; skipped: number }> {
  const [orders, purchases] = await Promise.all([
    prisma.order.findMany({
      where: {
        user_id: userId, deleted_at: null, parent_order_id: null, recargo_equivalencia: !on,
        status: { in: [...EDITABLE_STATUSES, 'draft'] },
      },
      select: { id: true },
    }),
    prisma.parentOrder.findMany({
      where: {
        user_id: userId, recargo_equivalencia: !on,
        sub_orders: { some: { deleted_at: null, status: { in: [...EDITABLE_STATUSES, 'draft'] } } },
      },
      select: { id: true },
    }),
  ]);
  let changed = 0;
  let skipped = 0;
  for (const target of [...orders, ...purchases]) {
    const r = await setOrderRecargo(target.id, on);
    if (r.status === 'ok') changed += 1; else skipped += 1;
  }
  return { changed, skipped };
}
