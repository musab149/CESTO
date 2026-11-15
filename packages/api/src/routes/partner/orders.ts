import { Router } from 'express';
import { MAX_LINE_QUANTITY } from '../../lib/orderLimits';
// Prisma is a VALUE here, not just a type: the restock below builds its
// statement with Prisma.sql / Prisma.join.
import { Prisma, type OrderStatus } from '@prisma/client';
import { z } from 'zod';
import prisma from '../../lib/prisma';
import { success, error } from '../../lib/response';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/async';
import { notifyOrderStatusChange, notifyOrderEdited, notifyDeliveryFeeSet } from '../../lib/notifications';
import { settleRepEarning } from '../../lib/repEarnings';
import { resolveDraftOrder } from '../../lib/draftOrders';
import { editOrder } from '../../lib/editOrder';
import { deliveryFeeBlocker, orderFeeData } from '../../lib/deliveryFee';
import { PLACED_BY_CUSTOMER } from '../../lib/orderSource';

const router = Router();

// Partner-scoped order matcher.
//
// Post-Slice-4 (with MV_ORDER_SPLIT=true): a sub-order carries its own
// `store_id`, so the direct `store_id: partnerStoreId` clause matches
// exactly the orders that belong to this partner — one row per store per
// checkout, no sibling leakage.
//
// Pre-mv rows have `store_id = NULL` because the column didn't exist. To
// keep those visible we OR in the legacy `items.some.product.store_id`
// path, gated on `store_id IS NULL` so it can't double-count Slice-4
// sub-orders (which have both `store_id` set AND items whose products
// point at that store).
//
// A Cesto sub-order (store_id NULL, all items point at Cesto/null) is
// naturally excluded: it fails BOTH the direct clause and the legacy
// clause's inner `product.store_id = partnerStoreId` check.
function ownOrderWhere(partnerStoreId: string): Prisma.OrderWhereInput {
  return {
    OR: [
      { store_id: partnerStoreId },
      // Both creator columns being null is load-bearing. An order we build
      // for a customer — staff in the panel, or a rep at the door — is
      // Cesto-fulfilled by definition, so it keeps store_id NULL even when it
      // holds partner products. Without this it would match here and show up
      // in the dashboard of a partner who is not fulfilling it and cannot act
      // on it. The pre-mv rows this clause exists for are customer checkouts,
      // which have neither creator set. See lib/orderSource.
      {
        store_id: null,
        ...PLACED_BY_CUSTOMER,
        items: { some: { product: { store_id: partnerStoreId } } },
      },
    ],
  };
}

const listQuerySchema = z.object({
  status: z.enum(['pending', 'confirmed', 'preparing', 'on_the_way', 'delivered', 'cancelled', 'draft']).optional(),
  q: z.string().max(200).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  riderId: z.string().uuid().optional(),
}).passthrough();

router.get('/', asyncHandler(async (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return error(res, parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '), 422);
  }
  const storeId = req.partnerRole!.store.id;
  const { status, q, from, to, riderId } = parsed.data;

  // Soft-deleted (admin-hidden) orders never show up for a partner either —
  // if it was flagged as a test/mistake order, the vendor shouldn't see it.
  const where: any = { AND: [ownOrderWhere(storeId), { deleted_at: null }] };
  if (status)   where.AND.push({ status });
  if (from)     where.AND.push({ created_at: { gte: new Date(from) } });
  if (to)       where.AND.push({ created_at: { lte: new Date(to) } });
  if (riderId)  where.AND.push({ rider_id: riderId });
  if (q) {
    where.AND.push({
      OR: [
        { order_number: { contains: q, mode: 'insensitive' } },
        { user: { name:  { contains: q, mode: 'insensitive' } } },
        { user: { phone: { contains: q } } },
      ],
    });
  }

  const orders = await prisma.order.findMany({
    where,
    orderBy: { created_at: 'desc' },
    select: {
      id: true, order_number: true, status: true, total: true, payment_method: true,
      created_at: true,
      user:  { select: { id: true, name: true, phone: true } },
      rider: { select: { id: true, name: true } },
      _count: { select: { items: true } },
    },
  });
  return success(res, orders);
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const storeId = req.partnerRole!.store.id;
  const order = await prisma.order.findFirst({
    where: { id: req.params.id, deleted_at: null, ...ownOrderWhere(storeId) },
    include: {
      // Include ONLY items from this partner's store — a mixed-cart order
      // shouldn't leak sibling partner's product lines to this partner.
      // (Slice 4 replaces this with proper per-store sub-orders.)
      items: { where: { product: { store_id: storeId } } },
      user:  { select: { id: true, name: true, phone: true, email: true } },
      address: true,
      rider: true,
      invoices: {
        // The ISSUED one only. A draft locks nothing — it follows the order.
        // Exposed so the screen can stop OFFERING edits the server refuses;
        // the refusal itself stays in editOrder() and the fee route.
        // Any issued document, credit notes aside — NOT only facturas. The
        // screens need two different answers from one projection: `kind`
        // decides whether the order is locked (only a factura locks), while
        // mere presence decides whether "Invoice" offers to create one or
        // links to what exists. A partial unique index allows exactly one
        // issued non-credit-note per order, so offering a second is always
        // an error, albaran or not.
        where: { status: 'issued', kind: { not: 'credit_note' } },
        select: { id: true, invoice_number: true, issue_date: true, kind: true },
        // NEWEST FIRST, and the ordering is load-bearing now. Several
        // albaranes per order became legal when a quote stopped freezing its
        // order, so `take: 1` without an orderBy would hand the screens an
        // arbitrary one of them — most likely a stale quote the rep has
        // already replaced.
        orderBy: [{ issue_date: 'desc' }, { number: 'desc' }],
        take: 1,
      },
    },
  });
  if (!order) return error(res, 'Order not found.', 404);
  return success(res, order);
}));

// Partner status transitions are a SUBSET of the admin matrix — cancellations
// stay with customer/admin. Every other forward step is partner-controlled:
// pending → confirmed (accept the order into fulfilment, no payment/OTP
// gate yet), confirmed → preparing → on_the_way → delivered. Slice 6 adds
// the rider app which will also be able to flip on_the_way → delivered
// (whichever actor confirms delivery first wins; delivered is terminal so
// there's no double-mark risk).
const PARTNER_ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending:    ['confirmed'],
  confirmed:  ['preparing'],
  preparing:  ['on_the_way'],
  on_the_way: ['delivered'],
  delivered:  [],
  cancelled:  [],
  // partially_completed is a DERIVED parent-order status (see parentOrder.ts).
  // Never stored on an Order row, so a partner can never see or transition it.
  partially_completed: [],
  // draft → confirmed re-validates + decrements stock, so it can't be a
  // plain flip through this endpoint — it goes through the dedicated
  // POST /:id/confirm-stock below instead. Cancelling a draft goes through
  // the existing POST /:id/cancel, not this map either.
  draft: [],
};

const statusSchema = z.object({
  status: z.enum(['confirmed', 'preparing', 'on_the_way', 'delivered']),
});

router.put('/:id/status', validate(statusSchema), asyncHandler(async (req, res) => {
  const storeId = req.partnerRole!.store.id;
  const { status } = req.body as z.infer<typeof statusSchema>;

  const order = await prisma.order.findFirst({
    where: { id: req.params.id, deleted_at: null, ...ownOrderWhere(storeId) },
    select: { id: true, status: true, rider_id: true, user_id: true, order_number: true },
  });
  if (!order) return error(res, 'Order not found.', 404);

  if (!PARTNER_ALLOWED_TRANSITIONS[order.status].includes(status)) {
    return error(res, `You cannot move an order from ${order.status} to ${status}.`, 400);
  }
  // Rider must be assigned before it leaves the store.
  if (status === 'on_the_way' && !order.rider_id) {
    return error(res, 'Assign a rider before marking the order as on the way.', 400);
  }

  const updated = await prisma.order.update({
    where: { id: order.id },
    // When it was delivered: a rep's earnings count by it (lib/repEarnings).
    data:  { status, ...(status === 'delivered' && { delivered_at: new Date() }) },
  });

  void notifyOrderStatusChange({
    userId:      updated.user_id,
    orderId:     updated.id,
    orderNumber: updated.order_number,
    status,
    reason:      null,
  });

  return success(res, updated);
}));

// Assign a rider — the rider must belong to the partner's own store (or be a
// platform-pool rider, but Slice 3 keeps it strict).
router.put('/:id/rider', validate(z.object({ riderId: z.string().uuid().nullable() })), asyncHandler(async (req, res) => {
  const storeId = req.partnerRole!.store.id;
  const { riderId } = req.body as { riderId: string | null };

  // Confirm order belongs to this partner.
  const order = await prisma.order.findFirst({
    where: { id: req.params.id, deleted_at: null, ...ownOrderWhere(storeId) },
    select: { id: true },
  });
  if (!order) return error(res, 'Order not found.', 404);

  if (riderId) {
    const rider = await prisma.rider.findUnique({
      where: { id: riderId }, select: { store_id: true },
    });
    if (!rider || rider.store_id !== storeId) {
      return error(res, 'That rider does not belong to your store.', 400);
    }
  }

  const updated = await prisma.order.update({
    where: { id: order.id },
    data:  { rider_id: riderId },
  });
  return success(res, updated);
}));

// ─── POST /api/partner/orders/:id/cancel ────────────────
// Partner-initiated cancellation. Allowed while the order hasn't left the
// store yet (pending / confirmed / preparing). Once it's on_the_way the
// rider is out and this becomes the rider/admin's call, not the partner's.
// Reason is required + min 5 chars so the customer email carries something
// meaningful (empty reasons cause support tickets).
//
// Restocks every item in the sub-order the same way customer-cancel does.
// Slice 4 note: sub-orders only contain this store's items, so restocking
// only touches this partner's stock — no risk of stepping on sibling subs.
const cancelSchema = z.object({
  reason: z.string().trim().min(5, 'Please give at least a short reason (≥5 chars).').max(500),
});

router.post('/:id/cancel', validate(cancelSchema), asyncHandler(async (req, res) => {
  const storeId = req.partnerRole!.store.id;
  const { reason } = req.body as z.infer<typeof cancelSchema>;

  const updated = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findFirst({
      where: { id: req.params.id, deleted_at: null, ...ownOrderWhere(storeId) },
      include: {
        // Restock only items belonging to THIS partner — safety for pre-mv
        // mixed-store orders where the sub-order includes items from other
        // stores. Post-Slice-4 sub-orders only carry this store's items so
        // the filter is a no-op then.
        items: { where: { product: { store_id: storeId } } },
      // ONLY A FACTURA LOCKS. A albaran is not a fiscal document — it is a
      // quote, and revising a quote is what a quote is for. Freezing an
      // order because someone printed one is backwards, and until the CIF
      // and the VAT review land, EVERY document is an albarán, so without
      // this every order would be frozen for a non-fiscal reason.
        invoices: { where: { status: 'issued', kind: 'invoice' }, select: { invoice_number: true } },
      },
    });
    if (!order) throw new HttpError(404, 'Order not found.');

    // An ISSUED invoice is a legal document stating this order's contents and
    // totals. Cancelling the order out from under it leaves that document
    // describing something that no longer exists — the same drift the item
    // and fee guards prevent, in its most drastic form. The fiscal fix is a
    // credit note (factura rectificativa), not a cancellation.
    //
    // ADMIN IS DELIBERATELY NOT BLOCKED. Credit notes are not built yet, so
    // blocking every path would create orders that must be cancelled and
    // cannot be — an unresolvable state is worse than a recorded one. Admin
    // stays the escape hatch, and takes on issuing the correction.
    if (order.invoices.length > 0) {
      throw new HttpError(
        409,
        `Invoice ${order.invoices[0].invoice_number} has already been issued for this order, so it can no longer be cancelled here. Contact us and we will sort it out.`,
      );
    }
    if (!['pending', 'confirmed', 'preparing', 'draft'].includes(order.status)) {
      throw new HttpError(400, `You cannot cancel an order that is ${order.status.replace(/_/g, ' ')}.`);
    }

    // Restock — skipped for a draft order, since its items were never
    // decremented at checkout (there was no stock to reserve).
    if (order.status !== 'draft') {
      // ONE statement, netted per variant — the shape create, confirm, cancel
      // and delete all use now. A round-trip to Neon per line is what put a
      // big order's restock on the wrong side of the transaction budget, and
      // the same variant on two lines cost two of them to put back one row.
      const giveBack = new Map<string, number>();
      for (const item of order.items) {
        giveBack.set(item.variant_id, (giveBack.get(item.variant_id) ?? 0) + item.quantity);
      }
      if (giveBack.size > 0) {
        const rows = [...giveBack.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
        await tx.$executeRaw`
          UPDATE product_variants AS v
             SET stock_quantity = v.stock_quantity + d.qty
            FROM (VALUES ${Prisma.join(
              rows.map(([id, qty]) => Prisma.sql`(${id}::uuid, ${qty}::int)`),
            )}) AS d(id, qty)
           WHERE v.id = d.id
        `;
      }
    }

    return tx.order.update({
      where: { id: order.id },
      data:  { status: 'cancelled', cancelled_reason: reason },
    });
  }, {
    // Cancelling restocks, so this is proportional to the order. Same budget
    // as every other order transaction — whether a partner can cancel a large
    // order should not depend on how warm the database happens to be.
    maxWait: 5_000,
    timeout: 8_000,
  });

  void notifyOrderStatusChange({
    userId:      updated.user_id,
    orderId:     updated.id,
    orderNumber: updated.order_number,
    status:      'cancelled',
    reason:      updated.cancelled_reason,
  });
  // A rep's order: noted on their earnings as not earned (lib/repEarnings).
  void settleRepEarning(updated.id);

  return success(res, updated);
}));

// ─── POST /api/partner/orders/:id/confirm-stock ─────────
// Resolves a `draft` sub-order for this partner's store: re-checks current
// stock for every item and, if it's all available now, decrements it and
// moves the order to `pending` — NOT `confirmed`. Resolving stock and
// accepting the order are different decisions; this just puts it back in
// the normal queue so the vendor still has to explicitly confirm it via
// PUT /:id/status, same as any other order. No customer notification fires
// here (see resolveDraftOrder) — they hear about it when it's actually
// confirmed. Separate from PUT /:id/status for the same reason as the
// admin endpoint — this is the one transition that mutates stock.

router.post('/:id/confirm-stock', asyncHandler(async (req, res) => {
  const storeId = req.partnerRole!.store.id;
  const result = await resolveDraftOrder(req.params.id, ownOrderWhere(storeId));

  if (result.status === 'not_found') return error(res, 'Order not found.', 404);
  if (result.status === 'not_draft') {
    return error(res, `This order is ${result.currentStatus.replace(/_/g, ' ')}, not draft.`, 400);
  }
  if (result.status === 'insufficient_stock') {
    return error(
      res,
      `Still short on stock: ${result.shortfalls.map((s) => `${s.productName} (need ${s.needed}, have ${s.available})`).join('; ')}`,
      409,
    );
  }

  return success(res, result.order);
}));

// ─── PUT /api/partner/orders/:id/items ──────────────────
// Edit line items on an order still in this store's control (pending/
// confirmed/preparing). All validation + the transaction lives in the
// shared editOrder() lib so admin and partner can never drift on what an
// edit actually does. Ownership is enforced two ways: ownOrderWhere()
// scopes which ORDER the caller can touch at all, and every order_item_id
// in the payload must belong to an item whose product.store_id is this
// store — same mixed-cart safety as GET /:id above.
const editItemsSchema = z.object({
  operations: z.array(z.discriminatedUnion('action', [
    z.object({ action: z.literal('update_qty'), order_item_id: z.string().uuid(), new_quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY) }),
    z.object({ action: z.literal('replace'), order_item_id: z.string().uuid(), new_variant_id: z.string().uuid(), new_quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY).optional() }),
    z.object({ action: z.literal('remove'), order_item_id: z.string().uuid() }),
    z.object({ action: z.literal('add'), new_variant_id: z.string().uuid(), new_quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY) }),
  ])).min(1),
  note: z.string().max(500).optional(),
});

router.put('/:id/items', validate(editItemsSchema), asyncHandler(async (req, res) => {
  const storeId = req.partnerRole!.store.id;
  const { operations, note } = req.body as z.infer<typeof editItemsSchema>;

  const targetIds = operations.filter((o) => o.action !== 'add').map((o) => (o as { order_item_id: string }).order_item_id);
  const ownedCount = await prisma.orderItem.count({
    where: { id: { in: targetIds }, order_id: req.params.id, product: { store_id: storeId } },
  });
  if (ownedCount !== new Set(targetIds).size) {
    return error(res, "One or more items are not part of your store's order.", 403);
  }

  // A replace/add target must also be one of THIS store's own products —
  // editOrder() itself has no store scoping on new_variant_id (admin has
  // none to enforce), so a partner could otherwise swap in / add any
  // store's variant via a crafted request.
  const newVariantIds = operations
    .filter((o): o is Extract<typeof o, { action: 'replace' | 'add' }> => o.action === 'replace' || o.action === 'add')
    .map((o) => o.new_variant_id);
  if (newVariantIds.length > 0) {
    const ownedVariantCount = await prisma.productVariant.count({
      where: { id: { in: newVariantIds }, product: { store_id: storeId } },
    });
    if (ownedVariantCount !== new Set(newVariantIds).size) {
      return error(res, 'One or more products are not in your store.', 403);
    }
  }

  const result = await editOrder(
    req.params.id,
    operations,
    { type: 'partner', partnerUserId: req.partnerRole!.user.id },
    ownOrderWhere(storeId),
    note,
  );

  if (result.status === 'not_found') return error(res, 'Order not found.', 404);
  if (result.status === 'not_editable') {
    return error(res, `This order is ${result.currentStatus.replace(/_/g, ' ')} and can no longer be edited.`, 400);
  }
  if (result.status === 'invalid_operation') return error(res, result.message, 400);
  if (result.status === 'insufficient_stock') {
    return error(
      res,
      `Not enough stock: ${result.shortfalls.map((s) => `${s.productName} (need ${s.needed}, have ${s.available})`).join('; ')}`,
      400,
    );
  }
  // An issued invoice freezes this order's contents. editOrder() refuses
  // rather than letting the two disagree; the correction is a credit note.
  if (result.status === 'invoiced') {
    return error(
      res,
      `Invoice ${result.invoiceNumber} has already been issued for this order. Issue a credit note instead of changing the items.`,
      409,
    );
  }
  // A 'slot_full' branch was here for exhaustiveness. It was already
  // unreachable — the ownership pre-check above stops a partner referencing
  // another store's variant, so editOrder() never opens a cross-store split
  // on this path — and the variant itself is gone with booked windows.

  void notifyOrderEdited({
    userId: result.order.user_id,
    orderId: result.order.id,
    orderNumber: result.order.order_number,
  });

  return success(res, { order: result.order, newOrders: result.newOrders });
}));

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
// ─── PUT /api/partner/orders/:id/delivery-fee ───────────
//
// The shop prices its own delivery, because the shop is the one holding the
// parcel. What a delivery costs is a judgement about weight and bulk that
// nobody at Cesto can make from a line-item list.
//
// Mirrors PUT /api/admin/orders/:id/delivery-fee exactly, including all
// three refusals, and adds partner scoping on top. Kept as a sibling rather
// than a shared helper because the two differ in scoping, in who is told
// afterwards, and in the wording of every refusal — a helper would be three
// parameters pretending to be one function.
//
// Open to BOTH owner and manager: PartnerRole's own definition gives a
// manager "same product / order / zone access as owner", and pricing a
// parcel is order work. The router's requirePartnerRole() already admits
// both, so there is no extra guard here — that is deliberate, not missing.

const partnerDeliveryFeeSchema = z.object({
  delivery_fee: z.number().nonnegative().max(1000),
});

router.put('/:id/delivery-fee', validate(partnerDeliveryFeeSchema), asyncHandler(async (req, res) => {
  const storeId = req.partnerRole!.store.id;
  const { delivery_fee } = req.body as z.infer<typeof partnerDeliveryFeeSchema>;

  const order = await prisma.order.findFirst({
    where: { id: req.params.id, deleted_at: null, ...ownOrderWhere(storeId) },
    select: {
      id: true, status: true, subtotal: true, delivery_fee: true,
      parent_order_id: true, order_number: true, user_id: true, recargo_equivalencia: true,
    // ONLY A FACTURA LOCKS. A albaran is not a fiscal document — it is a
    // quote, and revising a quote is what a quote is for. Freezing an
    // order because someone printed one is backwards, and until the CIF
    // and the VAT review land, EVERY document is an albarán, so without
    // this every order would be frozen for a non-fiscal reason.
      invoices: { where: { status: 'issued', kind: 'invoice' }, select: { invoice_number: true } },
    },
  });
  // Scoped find, so another store's order is indistinguishable from one that
  // does not exist — which is the point.
  if (!order) return error(res, 'Order not found.', 404);

  // Shared with the admin route so the two can never drift on WHEN a fee may
  // change. The wording is this route's own: a partner asks us for a credit
  // note rather than issuing one, and "contact us" is the real next step.
  const blocked = deliveryFeeBlocker(order);
  if (blocked?.kind === 'not_editable') {
    return error(
      res,
      'The delivery fee can only be changed while an order is pending, confirmed or preparing.',
      422,
    );
  }
  if (blocked?.kind === 'invoiced') {
    return error(
      res,
      `Invoice ${blocked.invoiceNumber} has already been issued for this order. Ask us for a credit note instead of changing the price.`,
      409,
    );
  }
  if (blocked?.kind === 'split') {
    return error(
      res,
      'This order is one part of a larger purchase, and its delivery is priced for the whole purchase rather than this part. Contact us to change it.',
      422,
    );
  }

  // The fee, and the recargo de equivalencia that follows it (2026-11-04).
  const applied = await orderFeeData(prisma, order, delivery_fee);
  const previous = order.delivery_fee;

  const updated = await prisma.order.update({
    where: { id: order.id },
    data: applied,
    select: { id: true, subtotal: true, delivery_fee: true, total: true },
  });

  // Tell the customer what their delivery comes to — the same notice the
  // admin and rep routes send (notifyDeliveryFeeSet), which says nothing when
  // the number did not move.
  void notifyDeliveryFeeSet({
    userId: order.user_id, orderId: order.id, orderNumber: order.order_number,
    before: Number(previous), after: Number(updated.delivery_fee), total: Number(updated.total),
  });

  return success(res, updated);
}));

router.use((err: unknown, _req: any, res: any, next: any) => {
  if (err instanceof HttpError) return error(res, err.message, err.status);
  next(err);
});

export default router;
