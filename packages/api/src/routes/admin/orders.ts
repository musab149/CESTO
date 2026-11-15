import { Router, type Response as ExpressResponse } from 'express';
import { MAX_ORDER_LINES, MAX_LINE_QUANTITY } from '../../lib/orderLimits';
import { z } from 'zod';
import { Prisma, OrderStatus } from '@prisma/client';
import prisma from '../../lib/prisma';
import { VAT_FIELDS } from '../../lib/pricing';
import { success, error } from '../../lib/response';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/async';
import { parsePage, paged, type PageParams } from '../../lib/pagination';
import {
  notifyOrderStatusChange, notifyOrderEdited, notifyAdminNewOrder,
  notifyPartnerOrder, announceOrderBuiltForCustomer, notifyDeliveryFeeSet, notifyRepEarning,
} from '../../lib/notifications';
import { requireRole } from '../../middleware/adminAuth';
import {
  EARNING_ORDER_SELECT, EarningError, adminEarningView, approveOrderEarning, earningInputSchema,
  saveOrderEarningInputs, settleRepEarning,
} from '../../lib/repEarnings';
import { resolveDraftOrder } from '../../lib/draftOrders';
import {
  afterPlanOrderChange, afterPlanDraftConfirmed, repricePlanDraft, homeGroceryFieldsFor, slotSchema, PlanError,
} from '../../lib/homeGroceryPlan';
import { editOrder, isEditableDraft } from '../../lib/editOrder';
import { trackProgress, readProgress } from '../../lib/orderProgress';
import { deliveryFeeBlocker, applyDeliveryFee, orderFeeData } from '../../lib/deliveryFee';
import { restatePurchaseTotals } from '../../lib/purchaseTotals';
import { setOrderRecargo } from '../../lib/orderRecargo';
import { deriveParentOrderStatus } from '../../lib/parentOrder';
import {
  BUILT_BY_US, BUILT_BY_REP, PLACED_BY_CUSTOMER, BUILT_BY_US_SQL, PLACED_BY_CUSTOMER_SQL,
} from '../../lib/orderSource';
import { issuedFacturaFor } from '../../lib/invoicing';
import { listGroupedOrders } from '../../lib/orderGroupList';
import { billFor } from '../../lib/bill';
import { restockItems } from '../../lib/restock';
import {
  createOrderForCustomer, CreateOrderError, createOrderCoreShape,
} from '../../lib/createOrder';

const router = Router();

// ─── GET /api/admin/orders ──────────────────────────────

const listQuerySchema = z.object({
  status: z.enum(['pending', 'confirmed', 'preparing', 'on_the_way', 'delivered', 'cancelled', 'draft']).optional(),
  q: z.string().max(200).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  riderId: z.string().uuid().optional(),
  /**
   * Scope to one customer. The customer page's "see all orders" needs every
   * order for a person, which `q` could only approximate by name — and a name
   * is not unique, so two customers called the same thing would have seen
   * each other's purchases.
   */
  userId: z.string().uuid().optional(),
  /**
   * Scope to one sales rep's orders — the rep profile's "view all", which
   * shows only the latest ten itself.
   */
  salesRepId: z.string().uuid().optional(),
  /**
   * Who placed it, which is what separates the two order books.
   *
   * `customer` is a checkout somebody made for themselves on the shop.
   * `admin` is one a rep built in the panel on a customer's behalf.
   *
   * `rashan` is the OLD NAME for `admin` and still accepted, because the two
   * are not the same thing and never were: a rep-built order for a wholesale
   * account is a B2B order, not a rashan one. Keeping the alias means a
   * frontend deployed before the API, or after it, works either way — the
   * alternative was a zod 422 on the orders page for the length of a deploy.
   *
   * The column already existed: Order.created_by_admin_id is null for every
   * customer checkout and set for every rep-built order, so this needs no
   * new field and no backfill.
   *
   * Omitted means both. A customer's own order history wants everything they
   * have ever had, however it was placed.
   */
  source: z.enum(['customer', 'rashan', 'admin', 'sales_rep']).optional(),
  /**
   * Who the order is FOR, which is a different axis from who placed it.
   *
   * `source` asks whether a rep built the order; this asks whether the buyer
   * was a wholesale account. They are independent on purpose: a rep building
   * an order for a business customer is both, and it belongs in both lists.
   *
   * Read from Order.buyer_is_business — what was true WHEN THE ORDER WAS
   * PLACED — not from the user's type today. Reading it live meant upgrading
   * a customer moved all their past orders into another book and rewrote last
   * month's revenue. Rows predating that column are null and fall back to the
   * live user, which is the best answer available for them.
   */
  customerType: z.enum(['retail', 'b2b']).optional(),
  /**
   * Opt in to the grouped shape — one row per checkout instead of one row
   * per Order row. A string enum rather than `z.coerce.boolean()`, which
   * turns every non-empty value (including the literal "false") into true.
   *
   * Opt-in rather than the default for two reasons: the flat shape is still
   * the right answer for "this rider's last 10 orders" (admin RidersPage),
   * and an admin bundle deployed before this change keeps receiving exactly
   * what it did yesterday, so the two deploys need no ordering.
   */
  grouped: z.enum(['true', 'false']).optional(),
}).passthrough(); // page/limit handled by parsePage — don't reject them

type ListFilters = z.infer<typeof listQuerySchema>;

/**
 * ─── Why this endpoint has two shapes ──────────────────────
 *
 * One checkout does not always produce one Order row. Checkout buckets the
 * cart by (store, availability) and writes a ParentOrder with one sub-Order
 * per bucket — and NOT only for multi-store carts: with MV_DRAFT_ORDERS on,
 * which is the default (see lib/mv-flags.ts), a single store holding one
 * out-of-stock item yields two subs, one live and one draft. Editing an
 * order can spin off another sub for a different store, promoting a
 * standalone order into a parent on the way (lib/editOrder.ts).
 *
 * Listed flat, one customer purchase therefore appears as two, three or four
 * unrelated lines with different order numbers and part-totals, and the only
 * thing tying them together is a chip the admin bundle hides unless
 * VITE_MV_ORDER_SPLIT happens to be set. Grouped mode collapses them back
 * into the thing the customer actually bought.
 *
 * The group key is COALESCE(parent_order_id, id), so a plain single-store
 * order is simply a group of one and no branch has to special-case the
 * pre-mv shape.
 *
 * Paging runs over GROUPS, in SQL, rather than folding a page of Orders
 * afterwards — fold-after-fetch makes "20 per page" mean "however many rows
 * survived the fold", and makes `total` count sub-orders, so the pager
 * offers pages that don't exist.
 */

/** What each sub-order contributes to its group, and what a sub-row renders. */

router.get('/', asyncHandler(async (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return error(res, parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '), 422);
  }
  const params = parsePage(req.query, 20, 100);
  const { status, q, from, to, riderId, userId, salesRepId, source, customerType } = parsed.data;

  if (parsed.data.grouped === 'true') {
    return success(res, await listGroupedOrders(parsed.data, params));
  }

  // Soft-deleted (admin-hidden test/mistake) orders never show up in the
  // list — they still exist for direct GET /:id lookups, just excluded
  // here and from every dashboard aggregate.
  const where: Prisma.OrderWhereInput = { deleted_at: null };
  if (status) where.status = status as OrderStatus;
  if (riderId) where.rider_id = riderId;
  if (userId) where.user_id = userId;
  if (salesRepId) where.created_by_sales_rep_id = salesRepId;
  /**
   * EVERYTHING THAT NEEDS AN `OR` GOES ON `AND`, not on `where.OR`.
   *
   * Three filters here want one: who built it, what kind of buyer, and the
   * search. Assigned to `where.OR` they overwrite each other silently — and
   * two of them already did, so searching inside the B2B tab was quietly
   * returning orders of both kinds. Composing onto AND is the only shape
   * where adding a fourth cannot break the other three.
   */
  const and: Prisma.OrderWhereInput[] = [];

  if (source === 'customer') and.push(PLACED_BY_CUSTOMER);
  if (source === 'admin' || source === 'rashan') and.push(BUILT_BY_US);
  // Narrower than `admin`, and used WITHOUT a customerType — see BUILT_BY_REP.
  if (source === 'sales_rep') and.push(BUILT_BY_REP);
  if (customerType) {
    const wanted = customerType === 'b2b';
    and.push({
      OR: [
        { buyer_is_business: wanted },
        { buyer_is_business: null, user: { is_business: wanted } },
      ],
    });
  }
  if (from || to) {
    where.created_at = {};
    if (from) where.created_at.gte = new Date(from);
    if (to) where.created_at.lte = new Date(to);
  }
  if (q) {
    and.push({
      OR: [
        { order_number: { contains: q, mode: 'insensitive' } },
        { user: { name: { contains: q, mode: 'insensitive' } } },
        { user: { phone: { contains: q } } },
      ],
    });
  }
  if (and.length > 0) where.AND = and;

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      select: {
        id: true, order_number: true, status: true, total: true,
        payment_method: true, created_at: true,
        user: { select: { id: true, name: true, phone: true } },
        rider: { select: { id: true, name: true } },
        _count: { select: { items: true } },
        // MV Slice 4 additions — every field null for pre-mv rows and
        // single-store legacy checkouts. Frontend uses `parent_order`
        // (slim projection: id + order_number) to render a "part of #P"
        // chip that links to the parent detail; `store` renders the
        // per-row Cesto/partner attribution in a Store column when
        // VITE_MV_ORDER_SPLIT is on.
        parent_order_id: true,
        parent_order: { select: { id: true, order_number: true } },
        store: { select: { id: true, slug: true, name: true } },
      },
      orderBy: { created_at: 'desc' },
      skip: params.skip,
      take: params.limit,
    }),
    prisma.order.count({ where }),
  ]);

  return success(res, paged(orders, total, params));
}));

// ─── GET /api/admin/orders/:id ──────────────────────────

// ─── GET /api/admin/orders/progress/:key ────────────────
// Where this admin's own big order operation has got to — create, save
// changes, cancel — polled by the page while the request runs. Declared
// before /:id, which would otherwise read "progress" as an order id. 404 for
// an unknown key or another admin's: deliberately indistinguishable.
router.get('/progress/:key', (req, res) => {
  const view = readProgress(req.params.key, `admin:${req.admin!.adminId}`);
  if (!view) return error(res, 'No progress for that key.', 404);
  return success(res, view);
});

// GET /api/admin/orders/:id/bill — the Bill (lib/bill): our company name,
// the customer's name, lines and totals, and nothing else. An order or a
// split purchase, by either id; a part bills its whole purchase.
// PUT /api/admin/orders/:id/item-costs — the buying price of this order's
// lines (2026-10-27, user: "on each order we should be able to edit the
// buying price... It will be done by the admin and not the reps"). Lines of
// the order, or of any live part when :id is a split purchase. Not what the
// customer pays, so it is allowed in any status, a factura's too: nothing it
// touches is on a document.
//
// The product follows (2026-10-27, user, asked whether a line's price should
// also become the product's: "Yes, everywhere"). The latest figure entered
// is the size's buying price, as the card in the order builder shows it.
// Only a figure above 0: 0 on a line means "not entered", and clearing one
// must not wipe what the product had.
const itemCostsSchema = z.object({
  items: z.array(z.object({
    order_item_id: z.string().uuid(),
    unit_cost: z.number().min(0).max(100000),
  }).strict()).min(1).max(1000),
}).strict();

router.put('/:id/item-costs', validate(itemCostsSchema), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { items } = req.body as z.infer<typeof itemCostsSchema>;
  const ids = [...new Set(items.map((i) => i.order_item_id))];
  if (ids.length !== items.length) return error(res, 'A line is listed twice.', 422);
  const owned = await prisma.orderItem.findMany({
    where: {
      id: { in: ids },
      OR: [{ order_id: id }, { order: { parent_order_id: id, deleted_at: null } }],
    },
    select: { id: true, variant_id: true },
  });
  if (owned.length !== ids.length) return error(res, 'Some of those lines are not on this order.', 422);

  // One figure per size; two lines of one size sent together, the later wins.
  const sizeOf = new Map(owned.map((o) => [o.id, o.variant_id]));
  const productCosts = new Map<string, number>();
  for (const i of items) if (i.unit_cost > 0) productCosts.set(sizeOf.get(i.order_item_id)!, i.unit_cost);

  const lineWrites = items.map((i) => prisma.orderItem.update({
    where: { id: i.order_item_id },
    data: { unit_cost: new Prisma.Decimal(i.unit_cost) },
    select: { id: true, unit_cost: true },
  }));
  // updateMany: a size deleted since the order was placed is simply skipped.
  const sizeWrites = [...productCosts].map(([variantId, cost]) => prisma.productVariant.updateMany({
    where: { id: variantId },
    data: { cost_price: new Prisma.Decimal(cost) },
  }));
  const updated = (await prisma.$transaction([...lineWrites, ...sizeWrites]))
    .slice(0, lineWrites.length) as Array<{ id: string; unit_cost: Prisma.Decimal }>;
  return success(res, {
    items: updated.map((u) => ({ id: u.id, unit_cost: u.unit_cost.toFixed(2) })),
    // The sizes whose buying price this set, so a screen can show it.
    products: [...productCosts].map(([variant_id, cost]) => ({ variant_id, cost_price: cost.toFixed(2) })),
  });
}));

router.get('/:id/bill', asyncHandler(async (req, res) => {
  const bill = await billFor(req.params.id);
  if (!bill) return error(res, 'Order not found.', 404);
  return success(res, bill);
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const order = await prisma.order.findUnique({
    where: { id: req.params.id },
    include: {
      // ORDERED. `items: true` is whatever order Postgres hands back, and an
      // UPDATE rewrites a row's tuple — so the line somebody just edited can
      // come back in a different place and the basket silently reshuffles
      // under them. OrderItem has no created_at, so the id is the stable key:
      // arbitrary, but the SAME arbitrary on every load.
      // With each line's buying price, which only this admin read asks for (lib/prisma).
      // And its product's IVA band, which a line made before lines recorded
      // their own rate (tax_rate_pct, 2026-11-01) is previewed and invoiced at.
      items: {
        orderBy: { id: 'asc' },
        omit: { unit_cost: false },
        include: { product: { select: VAT_FIELDS } },
      },
      // recargo_equivalencia: the order page offers to add recargo to an order
      // placed before the customer was put under the regime (2026-11-04).
      user: { select: { id: true, name: true, phone: true, email: true, recargo_equivalencia: true } },
      address: true,
      invoices: {
        // The ISSUED one only. A draft invoice locks nothing — it re-reads
        // its order on load, so it follows an edit rather than contradicting
        // it. Exposed so the screens can stop OFFERING edits the server will
        // refuse; the refusal itself lives in editOrder() and the fee routes,
        // and remains the real guard.
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
      rider: true,
      /**
       * WHO BUILT IT, by name and not just by id.
       *
       * The two columns were already in the payload — this is a findUnique
       * with no `select` — so the screen could tell a rep-built order from a
       * customer's and route its back link accordingly, and that is all it
       * could do. "Built by a sales rep, and I cannot tell you which one" is
       * not an answer to the question ops opens this page with, which is
       * usually "who do I ring about this".
       *
       * At most one is ever set; both are read because the label is the same
       * question either way.
       */
      created_by_admin: { select: { id: true, name: true } },
      created_by_sales_rep: { select: { id: true, name: true } },
      // MV Slice 4 — both null for pre-mv + single-store legacy checkouts.
      parent_order: true,
      store: { select: { id: true, slug: true, name: true, logo_url: true } },
    },
  });
  if (order) {
    // When the order is a sub, admin should be able to see the whole parent
    // context (siblings, per-store status, riders) without a second call.
    if (order.parent_order_id) {
      const siblings = await prisma.order.findMany({
        where: { parent_order_id: order.parent_order_id, id: { not: order.id } },
        select: {
          id: true, order_number: true, status: true,
          subtotal: true, delivery_fee: true, total: true,
          rider: { select: { id: true, name: true } },
          store: { select: { id: true, slug: true, name: true, logo_url: true } },
          _count: { select: { items: true } },
        },
        orderBy: { created_at: 'asc' },
      });
      const earning = (await repEarningViews([order.id])).get(order.id) ?? null;
      return success(res, { ...order, sibling_orders: siblings, rep_earning: earning });
    }
    return success(res, { ...order, rep_earning: (await repEarningViews([order.id])).get(order.id) ?? null });
  }

  // Not an Order — try ParentOrder (admin can look up either shape by id).
  const parent = await prisma.parentOrder.findUnique({
    where: { id: req.params.id },
    include: {
      // recargo_equivalencia: the order page offers to add recargo to an order
      // placed before the customer was put under the regime (2026-11-04).
      user: { select: { id: true, name: true, phone: true, email: true, recargo_equivalencia: true } },
      address: true,
      // The document covering the WHOLE purchase — see Invoice.parent_order_id.
      // Same projection the per-order branch uses, so the screens read one shape.
      invoices: {
        where: { status: 'issued', kind: { not: 'credit_note' } },
        select: { id: true, invoice_number: true, issue_date: true, kind: true },
        orderBy: [{ issue_date: 'desc' }, { number: 'desc' }],
        take: 1,
      },
      sub_orders: {
        include: {
          // Ordered, costed and IVA-banded for the same reasons as the lines above.
          items: {
            orderBy: { id: 'asc' },
            omit: { unit_cost: false },
            include: { product: { select: VAT_FIELDS } },
          },
          rider: true,
          store: { select: { id: true, slug: true, name: true, logo_url: true } },
          // A ParentOrder has no creator of its own — a split purchase is
          // built, or placed, once and then stored as several Orders. So the
          // parts carry the answer and the header reads it off them.
          created_by_admin: { select: { id: true, name: true } },
          created_by_sales_rep: { select: { id: true, name: true } },
        },
        orderBy: { created_at: 'asc' },
      },
    },
  });
  if (!parent) return error(res, 'Order not found.', 404);

  // A deleted shop is not part of the purchase any more, so it does not get
  // listed as one. The parts are read from the live sub-orders only — the
  // stored totals are recomputed on delete to match (see /:id/delete), and a
  // page that showed a deleted part would disagree with both them and the
  // orders list, which folds deleted rows out already.
  const liveSubs = parent.sub_orders.filter((s) => !s.deleted_at);
  // Each part a rep built earns them on its own (lib/repEarnings).
  const earnings = await repEarningViews(liveSubs.map((s) => s.id));

  return success(res, {
    ...parent,
    sub_orders: liveSubs.map((s) => ({ ...s, rep_earning: earnings.get(s.id) ?? null })),
    // A ParentOrder has no status or deleted_at column of its own. Both are
    // sent derived, so the detail header shows the same state as the row the
    // admin clicked to get here, and a purchase whose every part is gone
    // reads as deleted rather than as an empty purchase.
    derived_status: deriveParentOrderStatus(
      (liveSubs.length > 0 ? liveSubs : parent.sub_orders).map((s) => s.status),
    ),
    deleted_at: liveSubs.length === 0
      ? parent.sub_orders.reduce<Date | null>(
        (latest, s) => (s.deleted_at && (!latest || s.deleted_at > latest) ? s.deleted_at : latest),
        null,
      )
      : null,
    deleted_sub_order_count: parent.sub_orders.length - liveSubs.length,
  });
}));

// ─── PUT /api/admin/orders/:id/status ───────────────────

const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['preparing', 'cancelled'],
  preparing: ['on_the_way', 'cancelled'],
  on_the_way: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
  // partially_completed is a DERIVED parent-order status (see parentOrder.ts).
  // It is never stored on an Order row, but the enum forces us to be exhaustive.
  partially_completed: [],
  // draft → confirmed is NOT allowed here — that transition has to
  // re-validate + decrement stock, so it only happens through the dedicated
  // POST /:id/confirm-stock endpoint below. Cancelling a draft is a plain
  // flip (nothing was ever decremented), so it stays on this generic path.
  draft: ['cancelled'],
};

const statusSchema = z.object({
  status: z.enum(['pending', 'confirmed', 'preparing', 'on_the_way', 'delivered', 'cancelled']),
  reason: z.string().max(500).optional(),
});

router.put('/:id/status', validate(statusSchema), asyncHandler(async (req, res) => {
  const { status, reason } = req.body;
  // Only a cancel is worth showing progress for: it restocks every line.
  const progress = status === 'cancelled'
    ? trackProgress(req, res, `admin:${req.admin!.adminId}`, 'cancel', { txBudgetMs: 8_000 })
    : null;

  const updated = await prisma.$transaction(async (tx) => {
    progress?.txStart();
    const order = await tx.order.findUnique({
      where: { id: req.params.id },
      include: { items: true },
    });
    if (!order) return null;
    progress?.detail({ lines: order.items.length });

    if (!ALLOWED_TRANSITIONS[order.status].includes(status)) {
      throw Object.assign(new Error(`Cannot move order from ${order.status} to ${status}.`), { status: 400 });
    }

    // A rider must be assigned before an order can leave the store or be marked delivered.
    // Otherwise admins can accidentally close out an order that never actually shipped.
    if ((status === 'on_the_way' || status === 'delivered') && !order.rider_id) {
      throw Object.assign(
        new Error('Assign a rider before moving the order to on_the_way or delivered.'),
        { status: 400 },
      );
    }

    // THERE IS DELIBERATELY NO INVOICE GUARD ON THIS ROUTE, and that is the
    // one asymmetry in the whole lock. A customer and a partner are both
    // refused a cancel once a factura exists (409, "contact us"); an admin
    // is not.
    //
    // The reason is that credit notes do not exist yet. Guarding every path
    // would create orders that MUST be cancelled — the shop burned down, the
    // customer never existed — and cannot be, with no way out until the
    // rectificativa flow ships. An unresolvable state is worse than a
    // recorded one, so admin stays the escape hatch and takes on issuing the
    // correction by hand.
    //
    // It is an escape hatch, not a free pass: the order keeps its invoice
    // and stays visible, and the admin order screen warns before the
    // confirmation when a factura exists. Deleting is blocked outright (see
    // POST /:id/delete) precisely because that one would hide the evidence.
    // Remove this comment and add the guard the day credit notes land.

    // Restock if cancelled by admin. Skipped when cancelling FROM draft —
    // a draft order's items were never decremented at checkout (nothing was
    // reserved), so restocking here would wrongly inflate stock_quantity.
    if (status === 'cancelled' && order.status !== 'cancelled' && order.status !== 'draft') {
      // ONE statement, netted per variant — the same shape create and delete
      // use, and now the same function the rep's cancel uses. See lib/restock.
      await restockItems(tx, order.items);
    }

    return tx.order.update({
      where: { id: order.id },
      data: {
        status,
        ...(status === 'cancelled' && { cancelled_reason: reason ?? null }),
        // When it was delivered: a rep's earnings count by it (lib/repEarnings).
        ...(status === 'delivered' && order.status !== 'delivered' && { delivered_at: new Date() }),
      },
    });
  }, {
    // The budget every other order transaction carries, for the reason
    // editOrder.ts spells out: Neon suspends an idle compute and the wake-up
    // lands inside the transaction. Cancelling also restocks, so this is not
    // the plain status flip it looks like — it is proportional to the order,
    // and the biggest orders are the ones most likely to be cancelled.
    maxWait: 5_000,
    timeout: 8_000,
  });
  progress?.txEnd();
  progress?.step('confirming');

  if (!updated) return error(res, 'Order not found.', 404);

  // Customer-facing ping. Skip 'pending' — it's the default, never a target.
  if (status !== 'pending') {
    void notifyOrderStatusChange({
      userId: updated.user_id,
      orderId: updated.id,
      orderNumber: updated.order_number,
      status,
      reason: status === 'cancelled' ? (reason ?? null) : null,
    });
  }
  // Moving it forward is the shop's own work and needs no telling; stopping
  // it does, or they pack something nobody will collect.
  if (status === 'cancelled') {
    void notifyPartnerOrder({ orderId: updated.id, kind: 'cancelled', by: 'cesto', reason: reason ?? null });
    void settleRepEarning(updated.id);
  }
  // A Home Grocery plan delivery that settles makes the plan's next one.
  if (status === 'delivered' || status === 'cancelled') void afterPlanOrderChange(updated.id);

  return success(res, updated);
}));

// ─── POST /api/admin/orders/:id/confirm-stock ───────────
// Resolves a `draft` order: re-checks current stock for every item and, if
// it's all available now, decrements it and moves the order to `pending` —
// NOT `confirmed`. Resolving stock and accepting the order are different
// decisions; this just puts it back in the normal queue so an admin/vendor
// still has to explicitly confirm it, same as any other order. No customer
// notification fires here (see resolveDraftOrder) — they hear about it when
// it's actually confirmed. Deliberately separate from PUT /:id/status —
// this is the one transition that mutates stock, so it can't be a plain
// flip through the generic path.

router.post('/:id/confirm-stock', asyncHandler(async (req, res) => {
  // A Home Grocery delivery is priced again at today's prices first.
  await repricePlanDraft(req.params.id);
  const result = await resolveDraftOrder(req.params.id);

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

  // It is a real order now. A shop's part goes to that shop to fulfil; an
  // order our team parked is announced to its customer only at this point,
  // because a draft was never one they had been told about. Each helper
  // ignores the case that is not its own.
  void notifyPartnerOrder({ orderId: result.order.id, kind: 'new' });
  void announceOrderBuiltForCustomer({ orderId: result.order.id });
  void afterPlanDraftConfirmed(result.order.id);

  return success(res, result.order);
}));

// ─── PUT /api/admin/orders/:id/rider ────────────────────

router.put('/:id/rider', validate(z.object({ riderId: z.string().uuid().nullable() })), asyncHandler(async (req, res) => {
  const order = await prisma.order.update({
    where: { id: req.params.id },
    data: { rider_id: req.body.riderId },
  });
  return success(res, order);
}));

// ─── PUT /api/admin/orders/:id/notes ────────────────────

router.put('/:id/notes', validate(z.object({ adminNotes: z.string().max(2000) })), asyncHandler(async (req, res) => {
  const order = await prisma.order.update({
    where: { id: req.params.id },
    data: { admin_notes: req.body.adminNotes },
  });
  return success(res, order);
}));

// ─── PUT /api/admin/orders/:id/items ────────────────────
// Edit line items on an order that hasn't left the store yet (pending/
// confirmed/preparing), or on a draft our team built — staff, a rep or Home Grocery (2026-11-04 —
// see isEditableDraft). Admin has no store scope — sees/edits any order.
// See editOrder() lib for the shared transaction/audit/stock/ParentOrder-
// aggregate logic partner and admin both delegate to.

  /**
   * 300 operations, the same cap the create path puts on lines.
   *
   * Not about the transaction any more — the writes are batched, so 300
   * operations cost the same statements as three. It is about Postgres's
   * limit of 65535 parameters in one statement: the batched UPDATE binds
   * eight per row, so the ceiling is around 8000 and the failure beyond it
   * would be a driver error rather than anything a person could act on.
   * Refusing at a number nobody will reach beats erroring at one nobody
   * can explain.
   */
const editItemsSchema = z.object({
  operations: z.array(z.discriminatedUnion('action', [
    z.object({ action: z.literal('update_qty'), order_item_id: z.string().uuid(), new_quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY) }),
    z.object({ action: z.literal('replace'), order_item_id: z.string().uuid(), new_variant_id: z.string().uuid(), new_quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY).optional() }),
    z.object({ action: z.literal('remove'), order_item_id: z.string().uuid() }),
    // Flat euros off one line. Capped far above any plausible line so a
    // typo cannot wreck an order, and 0 is how the UI clears it.
    // unit_discount: euros off ONE unit, remembered for the customer (lib/customerDiscounts).
    // discount_amount: the flat line figure older clients send. One of the two — see editOrder.
    z.object({ action: z.literal('set_discount'), order_item_id: z.string().uuid(), discount_amount: z.number().min(0).max(100000).optional(), unit_discount: z.number().min(0).max(100000).optional() }),
    z.object({ action: z.literal('add'), new_variant_id: z.string().uuid(), new_quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY), unit_discount: z.number().min(0).max(100000).optional() }),
  // One operation per line at most — editOrder() refuses two on the same
  // line — so the ceiling is the order's own, from lib/orderLimits.ts.
  // At 300 a full rewrite of a larger order could not be submitted at all.
  ])).min(1).max(MAX_ORDER_LINES),
  note: z.string().max(500).optional(),
});

router.put('/:id/items', validate(editItemsSchema), asyncHandler(async (req, res) => {
  const { operations, note } = req.body as z.infer<typeof editItemsSchema>;

  const progress = trackProgress(req, res, `admin:${req.admin!.adminId}`, 'edit', { txBudgetMs: 8_000 });
  const result = await editOrder(
    req.params.id,
    operations,
    { type: 'admin', adminId: req.admin!.adminId },
    {},
    note,
    progress,
  );
  progress.step('confirming');

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
  // A 'slot_full' branch was here, returning 409 when a cross-store split
  // needed the original's booked delivery window and that window was full.
  // Booked windows went with the zone system, so the result type no longer
  // has that variant and a split can no longer fail this way.

  // A DRAFT TELLS NOBODY. The customer has not been told about it yet — a
  // parked order is announced when its stock is confirmed — so "your order
  // was changed" would be news of an order they never heard of. It is
  // Cesto's, so no shop is packing it, and it never splits.
  if (result.order.status === 'draft') {
    return success(res, { order: result.order, newOrders: result.newOrders });
  }
  // EMPTIED, SO CANCELLED (lib/editOrder). What cancelling a draft does
  // afterwards, minus telling the customer — they never heard of it.
  if (result.status === 'draft_cancelled') {
    void settleRepEarning(result.order.id);
    void afterPlanOrderChange(result.order.id);
    return success(res, { order: result.order, newOrders: [], draftCancelled: true });
  }

  void notifyOrderEdited({
    userId: result.order.user_id,
    orderId: result.order.id,
    orderNumber: result.order.order_number,
    // THE RECOMPUTED TOTAL, which this did not pass: the email prints
    // "Nuevo total del pedido" from it and the default is 0, so every edit
    // made here told the customer their order now came to nothing. The
    // customer's own edit path (routes/orders.ts) always passed it.
    newTotal: Number(result.order.total),
  });

  // The shop packing it has to see the change before it ships. A no-op for
  // Cesto's own orders and for anything our team built.
  void notifyPartnerOrder({ orderId: result.order.id, kind: 'edited', by: 'cesto' });

  // Cross-store add/replace spun off a new order for another store —
  // ping ops the same way checkout does for any newly-created order, and
  // the shop it now belongs to. Only a customer's purchase splits this way;
  // an order our team built keeps every line (lib/editOrder).
  for (const n of result.newOrders) {
    void notifyAdminNewOrder({
      orderId: n.id,
      orderNumber: n.order_number,
      customerName: null,
      total: n.total,
    });
    void notifyPartnerOrder({ orderId: n.id, kind: 'new' });
  }

  return success(res, { order: result.order, newOrders: result.newOrders });
}));

// ─── POST /api/admin/orders/:id/delete ──────────────────
// Soft-delete: hides the order from lists and dashboard aggregates without
// removing the row.
//
// ANY STATUS CAN BE HIDDEN, delivered included. The status gate that used to
// stop it argued delivered orders are real fulfilled history — true, and it
// also meant a test order run end to end, or a duplicate nobody noticed until
// after the rider went out, was stuck in the books for good. The row survives
// either way, `deleted_at` only hides it, and the one case where hiding
// genuinely destroys evidence — an issued factura — is refused below on its
// own terms rather than by proxy through the status.

const deleteOrderSchema = z.object({ reason: z.string().max(500).optional() });

router.post('/:id/delete', validate(deleteOrderSchema), asyncHandler(async (req, res) => {
  const { reason } = req.body as z.infer<typeof deleteOrderSchema>;

  const result = await prisma.$transaction(async (tx) => {
    // ONE ORDER, OR A WHOLE PURCHASE — the id decides which, the same way
    // GET /:id does. Both are real intents and they are not the same one: a
    // split purchase is several Order rows the customer never saw as
    // separate, so "delete this purchase" has to take all of them together
    // or leave half a purchase behind. Dropping a single shop's part stays
    // available from that part's own page, for when only one shop is going.
    const single = await tx.order.findUnique({
      where: { id: req.params.id },
      include: { items: true },
    });
    const parent = single ? null : await tx.parentOrder.findUnique({
      where: { id: req.params.id },
      include: { sub_orders: { include: { items: true } } },
    });
    if (!single && !parent) return null;

    const targets = single ? [single] : parent!.sub_orders;
    const live = targets.filter((o) => !o.deleted_at);
    if (live.length === 0) {
      throw Object.assign(
        new Error(parent
          ? 'This purchase has already been deleted.'
          : 'This order has already been deleted.'),
        { status: 400 },
      );
    }

    // An issued FACTURA is a legal document naming this order. Hiding the
    // order from every list while that document stays valid and outstanding
    // leaves a receivable nobody can trace back to anything — the same drift
    // the edit and cancel guards prevent, except here the order does not even
    // remain visible to find. An albarán does not block — it is a quote, not
    // a claim.
    //
    // Cancelling is deliberately NOT restricted this way (see PUT
    // /:id/status): a cancelled order stays visible and auditable, and admin
    // has to stay able to resolve one. Deleting removes the evidence.
    //
    // Asked across every part at once: a split purchase's factura hangs off
    // the parent, so no sub-order carries one of its own, and a factura on
    // any part stops the whole purchase.
    const issuedFactura = await issuedFacturaFor(tx, live);
    if (issuedFactura) {
      throw Object.assign(
        new Error(
          `Invoice ${issuedFactura.invoice_number} has been issued for ${parent ? 'this purchase' : 'this order'}, so it cannot be deleted. Cancel it instead and issue a credit note.`,
        ),
        { status: 409 },
      );
    }

    // Restock ONLY what is still being held, which is not the same as "not a
    // draft" — and it is decided PER PART, because the parts of one purchase
    // can sit at different stages:
    //
    //   draft      nothing was ever decremented — there was no stock to take
    //   cancelled  PUT /:id/status already gave it back when it cancelled
    //   delivered  the goods physically left; they are not coming back
    //
    // The old rule restocked everything except a draft, so deleting an
    // already-cancelled order handed the stock back a SECOND time and
    // inflated it — a live bug, not just a hazard of allowing delivered here.
    // On_the_way still restocks: it is the undo of a dispatch that should not
    // have gone out, and the goods come back with the rider.
    const HOLDS_STOCK: OrderStatus[] = ['pending', 'confirmed', 'preparing', 'on_the_way'];

    // ONE statement for the whole purchase — not one per line, and not one
    // per shop. A serial update per line meant a round-trip to Neon each
    // time, which is what made the largest order on production impossible to
    // delete at all. Quantities are netted per variant first: the same
    // variant can appear on two lines, or in two shops of one purchase, and
    // every extra increment is another round-trip restoring the same row.
    const giveBack = new Map<string, number>();
    for (const o of live) {
      if (!HOLDS_STOCK.includes(o.status)) continue;
      for (const item of o.items) {
        giveBack.set(item.variant_id, (giveBack.get(item.variant_id) ?? 0) + item.quantity);
      }
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

    await tx.order.updateMany({
      where: { id: { in: live.map((o) => o.id) } },
      data: {
        deleted_at: new Date(),
        deleted_by_admin_id: req.admin!.adminId,
        delete_reason: reason ?? null,
      },
    });

    // Keep the purchase's stored totals honest about what is left in it.
    //
    // ParentOrder.subtotal and .total are columns, not derived, so dropping
    // one shop from a purchase otherwise leaves the parent still claiming the
    // full amount — a list row showing one total beside a different set of
    // parts. The delivery fee is deliberately NOT reduced: it belongs to the
    // purchase, and the rest of it is still being delivered.
    const parentId = parent?.id ?? single?.parent_order_id ?? null;
    if (parentId) {
      // Subtotal, recargo and total from what is left, the fee kept
      // (lib/purchaseTotals). A purchase with nothing left is left alone.
      await restatePurchaseTotals(tx, parentId);
    }

    return {
      kind: parent ? ('purchase' as const) : ('order' as const),
      id: parent?.id ?? single!.id,
      order_number: parent?.order_number ?? single!.order_number,
      deleted_count: live.length,
      deleted_order_ids: live.map((o) => o.id),
    };
  }, {
    // ─── Budget, for the reason editOrder.ts spells out ───────────────────
    //
    // This was the last order transaction still running on Prisma's defaults
    // (maxWait 2s / timeout 5s), and it failed the same way the edit path did
    // before it was given a budget: Neon suspends an idle compute, the
    // wake-up lands INSIDE the transaction and can eat the whole 5s before
    // any real work starts. That surfaces as a bare 5xx on an order that
    // deletes fine on the retry, which is exactly what made it so hard to pin
    // down — the second attempt hits a warm database.
    //
    // maxWait matters as much as timeout: it is how long Prisma waits for a
    // connection before starting, and a cold pool can exceed 2s by itself.
    //
    // 8s stays under the client's 10s request timeout, so the server loses
    // the race and can roll back and answer, rather than the client hanging
    // up on a transaction that goes on to commit.
    maxWait: 5_000,
    timeout: 8_000,
  });

  if (!result) return error(res, 'Order not found.', 404);

  // A shop's part that was still being worked on has just vanished from its
  // dashboard. Tell the shop the way a cancellation would; a part already
  // delivered or cancelled needs nothing said. Deleting leaves status alone,
  // so it still says which these were.
  const stillOpen = await prisma.order.findMany({
    where: {
      id: { in: result.deleted_order_ids },
      store_id: { not: null },
      status: { notIn: ['delivered', 'cancelled'] },
    },
    select: { id: true },
  });
  for (const o of stillOpen) {
    void notifyPartnerOrder({ orderId: o.id, kind: 'cancelled', by: 'cesto', reason });
  }
  // A rep's order deleted: its earning is taken back, or noted as not earned.
  for (const id of result.deleted_order_ids) void settleRepEarning(id);

  return success(res, result);
}));

// ─── A sales rep's earning on this order (lib/repEarnings) ──
// Reading comes with GET /:id. Writing is a super admin's: it decides what a
// rep is paid.

/** The admin's view of these orders' earnings, by order id — rep-built ones only. */
async function repEarningViews(orderIds: string[]) {
  const views = new Map<string, ReturnType<typeof adminEarningView>>();
  if (orderIds.length === 0) return views;
  const rows = await prisma.order.findMany({
    where: { id: { in: orderIds }, created_by_sales_rep_id: { not: null } },
    select: EARNING_ORDER_SELECT,
  });
  const repIds = [...new Set(rows.map((r) => r.created_by_sales_rep_id!))];
  const reps = await prisma.salesRep.findMany({
    where: { user_id: { in: repIds } },
    select: { user_id: true, commission_pct: true, user: { select: { name: true } } },
  });
  for (const o of rows) {
    const rep = reps.find((r) => r.user_id === o.created_by_sales_rep_id);
    // Built by someone who is no longer a rep at all: there is nobody to pay.
    if (!rep) continue;
    views.set(o.id, adminEarningView(o, { user_id: rep.user_id, name: rep.user.name, commission_pct: rep.commission_pct }));
  }
  return views;
}

function earningRefusal(res: ExpressResponse, e: unknown) {
  if (e instanceof EarningError) return error(res, e.message, e.status);
  throw e;
}

router.put('/:id/rep-earning', requireRole('super_admin'), validate(earningInputSchema), asyncHandler(async (req, res) => {
  try {
    await saveOrderEarningInputs(req.params.id, req.body, req.admin?.adminId ?? null);
  } catch (e) { return earningRefusal(res, e); }
  return success(res, (await repEarningViews([req.params.id])).get(req.params.id) ?? null);
}));

router.post('/:id/rep-earning/approve', requireRole('super_admin'), asyncHandler(async (req, res) => {
  try {
    const event = await approveOrderEarning(req.params.id, req.admin?.adminId ?? null);
    if (event) void notifyRepEarning(event);
  } catch (e) { return earningRefusal(res, e); }
  return success(res, (await repEarningViews([req.params.id])).get(req.params.id) ?? null);
}));

router.use((err: any, _req: any, res: any, next: any) => {
  if (err?.status) return error(res, err.message, err.status);
  next(err);
});


// ─── POST /api/admin/orders ─────────────────────────────
//
// Building an order FOR a customer. The rules, and the reasons for them, live
// in lib/createOrder — shared with POST /api/sales/orders, because a rep in the
// field and staff in the panel are doing the same thing and a second copy would
// drift from the first bug fixed in only one.
//
// Staff keep `admin_notes`: an internal note on an order is an ops field, and
// it is absent from the rep schema rather than guarded inside the shared
// function.

const createOrderSchema = z.object({
  ...createOrderCoreShape,
  admin_notes: z.string().max(2000).optional(),
  /** A Home Grocery order for an approved household: its slot. See lib/homeGroceryPlan. */
  home_grocery: slotSchema.optional(),
});

router.post('/', validate(createOrderSchema), asyncHandler(async (req, res) => {
  const { home_grocery: slot, ...body } = req.body as z.infer<typeof createOrderSchema>;

  // Every order of a household with a plan is one of its Home Grocery
  // orders (2026-10-23): the slot sent, or the plan's default one.
  let hg: Awaited<ReturnType<typeof homeGroceryFieldsFor>> = null;
  try {
    hg = await homeGroceryFieldsFor(body.user_id, slot, { staff: true });
  } catch (err) {
    if (err instanceof PlanError) return error(res, err.message, err.status);
    throw err;
  }

  const progress = trackProgress(req, res, `admin:${req.admin!.adminId}`, 'create', { txBudgetMs: 8_000 });
  try {
    const result = await createOrderForCustomer({ ...body, ...hg?.fields }, { adminId: req.admin?.adminId ?? null }, {
      // Optional: a screen that sends none behaves exactly as before.
      idempotencyKey: req.header('Idempotency-Key') ?? null,
      progress,
    });
    progress.step('confirming');
    // A replay built nothing, and the client already heard about it once.
    if (result.replayed) {
      return success(res, {
        order: result.order,
        delivery_fee_resolved: result.deliveryFeeResolved,
        delivery_fee_applied: result.deliveryFeeApplied,
      }, 200);
    }
    // Parked drafts are announced when they take their stock, not now.
    void announceOrderBuiltForCustomer({ orderId: result.order.id, feeDecided: body.delivery_fee !== undefined });
    if (hg) void afterPlanOrderChange(result.order.id);
    return success(res, {
      order: result.order,
      delivery_fee_resolved: result.deliveryFeeResolved,
      delivery_fee_applied: result.deliveryFeeApplied,
    }, 201);
  } catch (err) {
    if (err instanceof CreateOrderError) {
      return error(res, err.message, err.status, err.detail);
    }
    throw err;
  }
}));

// ─── PUT /api/admin/orders/:id/delivery-fee ─────────────
//
// The fee is a judgement, so it has to stay one after the order exists. A rep
// sets it at the counter from what the load looks like, and the load changes:
// items get added by an edit, or the parcel turns out heavier than it looked.
//
// Its own route rather than part of the items edit, because editOrder.ts
// deliberately does NOT touch the fee — it carries the stored one through —
// and threading a price override into that transaction would put a money
// decision inside the most safety-critical code in the repo.

const deliveryFeeSchema = z.object({
  delivery_fee: z.number().nonnegative().max(1000),
});

/**
 * Price a whole split purchase.
 *
 * The fee lives on the ParentOrder and the parts stay at zero, which is what
 * every reader of a split purchase already assumes — the customer's order
 * page shows `delivery_fee_total`, and the receipt and the invoice take the
 * parent's figures.
 *
 * The SAME rules as a single order decide whether it may change, through the
 * same deliveryFeeBlocker, so the two cannot drift:
 *   · the status, derived from the parts — a purchase half delivered is past
 *     re-pricing, the same as a delivered order is;
 *   · an issued factura, which is a fiscal document and is corrected with a
 *     credit note, not by editing the price underneath it.
 * `parent_order_id: null` is passed because this IS the parent; the split
 * refusal is for its parts.
 */
async function setParentDeliveryFee(id: string, fee: number, res: ExpressResponse) {
  const parent = await prisma.parentOrder.findUnique({
    where: { id },
    select: {
      id: true,
      subtotal: true,
      user_id: true,
      order_number: true,
      delivery_fee_total: true,
      sub_orders: { where: { deleted_at: null }, select: { status: true } },
      invoices: { where: { status: 'issued', kind: 'invoice' }, select: { invoice_number: true } },
    },
  });
  if (!parent) return error(res, 'Order not found.', 404);
  if (parent.sub_orders.length === 0) return error(res, 'Order not found.', 404);

  const blocked = deliveryFeeBlocker({
    status: deriveParentOrderStatus(parent.sub_orders.map((o) => o.status)),
    parent_order_id: null,
    invoices: parent.invoices,
  });
  if (blocked?.kind === 'not_editable') {
    return error(
      res,
      'The delivery fee can only be changed while a purchase is pending, confirmed or preparing.',
      422,
    );
  }
  if (blocked?.kind === 'invoiced') {
    return error(
      res,
      `Invoice ${blocked.invoiceNumber} has already been issued for this purchase. Issue a credit note instead of changing the price.`,
      409,
    );
  }

  // The fee, and everything that follows from it — the purchase's recargo
  // de equivalencia, when it is under the regime (the fee is part of its
  // base), and its total — restated from its live parts (lib/purchaseTotals).
  // Quantised once, so the fee and the total can never disagree by a cent.
  const restated = await prisma.$transaction((tx) => restatePurchaseTotals(tx, parent.id, new Prisma.Decimal(fee)));
  const updated = restated
    ? { id: restated.id, subtotal: restated.subtotal, delivery_fee_total: restated.delivery_fee_total, recargo: restated.recargo, total: restated.total }
    : await (async () => {
      // No live part left: nothing to charge recargo on; the fee alone.
      const { delivery_fee, total } = applyDeliveryFee(parent.subtotal, fee);
      return prisma.parentOrder.update({
        where: { id: parent.id },
        data: { delivery_fee_total: delivery_fee, total },
        select: { id: true, subtotal: true, delivery_fee_total: true, recargo: true, total: true },
      });
    })();
  void notifyDeliveryFeeSet({
    userId: parent.user_id, orderId: parent.id, orderNumber: parent.order_number,
    before: Number(parent.delivery_fee_total), after: Number(updated.delivery_fee_total), total: Number(updated.total),
  });

  return success(res, updated);
}

// ─── PUT /api/admin/orders/:id/recargo ──────────────────
//
// Recargo de equivalencia on an order already placed (2026-11-04): added when
// the customer was put under the regime after ordering, or taken off. The
// order's total follows, and so do its bill and factura. A part of a split
// purchase, or a purchase's id, changes the whole purchase (it is charged
// once, on the whole). Same window as the delivery fee: an order still
// changeable and without an issued factura (lib/orderRecargo).
const recargoSchema = z.object({ on: z.boolean() }).strict();

router.put('/:id/recargo', validate(recargoSchema), asyncHandler(async (req, res) => {
  const { on } = req.body as z.infer<typeof recargoSchema>;
  const r = await setOrderRecargo(req.params.id, on);
  if (r.status === 'not_found') return error(res, 'Order not found.', 404);
  if (r.status === 'not_editable') {
    return error(res, 'Recargo can only be changed while the order is pending, confirmed or preparing.', 422);
  }
  if (r.status === 'invoiced') {
    return error(res, `Invoice ${r.invoiceNumber} has already been issued for this order. Issue a credit note instead of changing the price.`, 409);
  }
  return success(res, { kind: r.kind, id: r.id, recargo: r.recargo, total: r.total });
}));

router.put('/:id/delivery-fee', validate(deliveryFeeSchema), asyncHandler(async (req, res) => {
  const { delivery_fee } = req.body as z.infer<typeof deliveryFeeSchema>;

  const order = await prisma.order.findUnique({
    where: { id: req.params.id },
    select: {
      id: true, status: true, subtotal: true, parent_order_id: true, deleted_at: true, recargo_equivalencia: true,
      user_id: true, order_number: true, delivery_fee: true,
      // Whether a draft is one our team built, which staff may change (isEditableDraft).
      created_by_admin_id: true, created_by_sales_rep_id: true, rashan_subscription_id: true,
    // ONLY A FACTURA LOCKS. A albaran is not a fiscal document — it is a
    // quote, and revising a quote is what a quote is for. Freezing an
    // order because someone printed one is backwards, and until the CIF
    // and the VAT review land, EVERY document is an albarán, so without
    // this every order would be frozen for a non-fiscal reason.
      invoices: { where: { status: 'issued', kind: 'invoice' }, select: { invoice_number: true } },
    },
  });
  /**
   * NOT AN ORDER? THEN IT IS A WHOLE PURCHASE, and that is where the fee
   * belongs.
   *
   * A split basket is one delivery — Cesto takes the whole package out — so
   * the fee is charged once, on the ParentOrder, and every sub-order carries
   * zero. The sub-order branch below refuses a fee for exactly that reason.
   * Until this existed the parent had no route at all: the id simply did not
   * match an Order and the admin got "Order not found", so a split purchase
   * could not be priced by anyone. That is survivable while delivery is
   * priced at checkout, and not survivable now a wholesale order arrives
   * deliberately unpriced.
   */
  if (!order) return setParentDeliveryFee(req.params.id, delivery_fee, res);
  if (order.deleted_at) return error(res, 'This order is deleted.', 422);

  // Shared with the partner route so the two can never drift on WHEN a fee
  // may change; the wording below is this route's own.
  const blocked = deliveryFeeBlocker(order, { draftOk: isEditableDraft(order) });
  if (blocked?.kind === 'not_editable') {
    return error(
      res,
      'The delivery fee can only be changed while an order is pending, confirmed or preparing, or still a draft built by staff or a rep.',
      422,
    );
  }
  if (blocked?.kind === 'invoiced') {
    return error(
      res,
      `Invoice ${blocked.invoiceNumber} has already been issued for this order. Issue a credit note instead of changing the price.`,
      409,
    );
  }
  if (blocked?.kind === 'split') {
    return error(
      res,
      'This order is part of a split purchase, where the delivery fee belongs to the whole purchase rather than this part.',
      422,
    );
  }

  const updated = await prisma.order.update({
    where: { id: order.id },
    // The fee, and the recargo de equivalencia that follows it (2026-11-04).
    data: await orderFeeData(prisma, order, delivery_fee),
    select: { id: true, subtotal: true, delivery_fee: true, recargo: true, total: true },
  });
  // Not for a draft: the customer has not been told about that order yet.
  if (order.status === 'draft') return success(res, updated);
  // The customer placed it without a fee (every customer order since
  // 2026-10-23) and is waiting to hear what it comes to.
  void notifyDeliveryFeeSet({
    userId: order.user_id, orderId: order.id, orderNumber: order.order_number,
    before: Number(order.delivery_fee), after: Number(updated.delivery_fee), total: Number(updated.total),
  });

  return success(res, updated);
}));

export default router;
