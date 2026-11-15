import { Router } from 'express';
import { MAX_ORDER_LINES, MAX_LINE_QUANTITY } from '../../lib/orderLimits';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { VAT_FIELDS } from '../../lib/pricing';
import { success, error } from '../../lib/response';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/async';
import { parsePage, paged } from '../../lib/pagination';
import {
  createOrderForCustomer, CreateOrderError, createOrderCoreShape,
} from '../../lib/createOrder';
import { listGroupedOrders } from '../../lib/orderGroupList';
import { draftInvoice } from '../../lib/invoiceActions';
import { issuedFacturaFor } from '../../lib/invoicing';
import { restockItems } from '../../lib/restock';
import { editOrder, isEditableDraft } from '../../lib/editOrder';
import { trackProgress } from '../../lib/orderProgress';
import { resolveDraftOrder } from '../../lib/draftOrders';
import { billFor } from '../../lib/bill';
import { EARNING_ORDER_SELECT, repEarningView, settleRepEarning } from '../../lib/repEarnings';
import {
  afterPlanOrderChange, afterPlanDraftConfirmed, repricePlanDraft, homeGroceryFieldsFor, slotSchema, PlanError,
} from '../../lib/homeGroceryPlan';
import { deliveryFeeBlocker, orderFeeData } from '../../lib/deliveryFee';
import {
  notifyOrderStatusChange, notifyOrderEdited, notifyAdminNewOrder,
  announceOrderBuiltForCustomer, notifyDeliveryFeeSet,
} from '../../lib/notifications';
import {
  REP_NO_STORE, REP_OUTSIDE_STORE, noStoreMessage, productsOutsideRepStore, sellsFrom,
} from '../../lib/repStore';
import { reachOf } from '../../lib/repClients';

/**
 * The orders a rep has built.
 *
 * Scoped by `created_by_sales_rep_id`, which is both the attribution and the
 * permission: a rep sees their own work and nothing else. There is no way to
 * widen it from the request, because no filter here takes a rep id.
 *
 * A rep gets the actions that are THEIR OWN WORK on an order they built —
 * editing it, cancelling it, confirming a parked draft's stock, the delivery
 * fee and the client's note. What ops owns is simply not here: no delete, no
 * rider, no invoice issuing, no march through the fulfilment statuses. The
 * endpoints a rep may not reach do not exist in this namespace rather than
 * existing behind a hidden button, which is the whole security model of
 * `/api/sales/*`. See the block above those routes for why each one is out.
 */

const router = Router();

const LIST_SELECT = {
  id: true,
  order_number: true,
  status: true,
  total: true,
  created_at: true,
  user: {
    select: {
      id: true, name: true, phone: true,
      business_profile: { select: { company: true } },
    },
  },
  _count: { select: { items: true } },
} as const;

// ─── GET /api/sales/orders ──────────────────────────────
router.get('/', asyncHandler(async (req, res) => {
  const repId = req.salesRep!.user.id;
  const params = parsePage(req.query, 20, 100);
  const status = typeof req.query.status === 'string' ? req.query.status : '';
  const clientId = typeof req.query.client === 'string' ? req.query.client : '';
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';

  /**
   * One row per PURCHASE, not per Order row.
   *
   * The same grouping the admin list uses, through the same function — a
   * checkout can be several Orders (split by store, and by availability when
   * an out-of-stock line is routed into its own draft), and a rep looking at
   * one of those has exactly the admin's problem. A second implementation
   * would be a list that adds the parts up differently.
   *
   * The rep scope goes INTO the query rather than filtering its results, so
   * the grouping, the count and the paging all see only their orders.
   */
  if (req.query.grouped === 'true') {
    return success(res, await listGroupedOrders(
      { status: status || undefined, q: q || undefined, userId: clientId || undefined },
      params,
      [Prisma.sql`o.created_by_sales_rep_id = ${repId}::uuid`],
    ));
  }

  const where: Prisma.OrderWhereInput = {
    created_by_sales_rep_id: repId,
    deleted_at: null,
  };
  if (status) where.status = status as Prisma.OrderWhereInput['status'];
  if (clientId) where.user_id = clientId;

  const [rows, total] = await Promise.all([
    prisma.order.findMany({
      where,
      select: LIST_SELECT,
      orderBy: { created_at: 'desc' },
      skip: params.skip,
      take: params.limit,
    }),
    prisma.order.count({ where }),
  ]);

  return success(res, paged(rows.map((o) => ({
    id: o.id,
    order_number: o.order_number,
    status: o.status,
    total: o.total.toString(),
    created_at: o.created_at,
    item_count: o._count.items,
    client: {
      id: o.user.id,
      name: o.user.name,
      phone: o.user.phone,
      company: o.user.business_profile?.company ?? null,
    },
  })), total, params));
}));

// ─── GET /api/sales/orders/:id/bill ─────────────────────
// The Bill (lib/bill) for an order this rep built: our company name, the
// client's name, lines and totals. Not theirs = not found, as on /:id.
router.get('/:id/bill', asyncHandler(async (req, res) => {
  const bill = await billFor(req.params.id, { created_by_sales_rep_id: req.salesRep!.user.id });
  if (!bill) return error(res, 'Order not found.', 404);
  return success(res, bill);
}));

// ─── GET /api/sales/orders/:id ──────────────────────────
router.get('/:id', asyncHandler(async (req, res) => {
  const repId = req.salesRep!.user.id;

  const order = await prisma.order.findFirst({
    // The rep id is part of the lookup, not a check after it. An order they did
    // not build is not found, which is also the honest answer: they have no way
    // to know it exists.
    where: { id: req.params.id, created_by_sales_rep_id: repId, deleted_at: null },
    include: {
      // ORDERED. `items: true` is whatever order Postgres hands back, and an
      // UPDATE rewrites a row's tuple — so the line somebody just edited can
      // come back in a different place and the basket silently reshuffles
      // under them. OrderItem has no created_at, so the id is the stable key:
      // arbitrary, but the SAME arbitrary on every load.
      // With the product's IVA band, which a line made before lines recorded
      // their own rate (tax_rate_pct, 2026-11-01) is previewed and invoiced at.
      items: { orderBy: { id: 'asc' }, include: { product: { select: VAT_FIELDS } } },
      user: {
        select: {
          id: true, name: true, email: true, phone: true, tax_id: true,
          is_business: true, pricing_mode: true,
          business_profile: { select: { company: true, contact_phone: true, registration_no: true } },
        },
      },
      address: true,
      // Read-only on this surface, but the page still SAYS who is carrying it —
      // a rep asked "where is my order" needs the answer, they just do not get
      // to change it.
      rider: { select: { id: true, name: true, phone: true } },
      store: { select: { id: true, slug: true, name: true } },
      // ALBARANES ONLY. A factura is the office's (2026-11-07): not its number,
      // not its id, not its draft. `factura_issued` below is all a rep is told,
      // because it is why they can no longer change the order.
      invoices: {
        where: { kind: 'albaran' },
        select: {
          id: true, invoice_number: true, kind: true, status: true, issue_date: true,
        },
        orderBy: { created_at: 'desc' },
      },
      /**
       * The other parts of the same purchase.
       *
       * A split is one thing the customer bought, stored as several rows. The
       * admin detail page shows the siblings so a part is never mistaken for
       * the whole order, and a rep reading a part-total without them would
       * quote the client the wrong number.
       */
      parent_order: {
        select: {
          id: true, order_number: true, subtotal: true, delivery_fee_total: true,
          total: true, payment_method: true, created_at: true,
        },
      },
    },
  });
  if (!order) return error(res, 'Order not found.', 404);

  const siblings = order.parent_order_id
    ? await prisma.order.findMany({
      where: {
        parent_order_id: order.parent_order_id,
        id: { not: order.id },
        deleted_at: null,
      },
      select: {
        id: true, order_number: true, status: true, total: true,
        store: { select: { id: true, name: true } },
        _count: { select: { items: true } },
      },
      orderBy: { created_at: 'asc' },
    })
    : [];

  // What they earn from it (lib/repEarnings): the whole breakdown, never a
  // buying price — those stay out of `items` too (lib/prisma).
  const [earningOrder, rep, factura] = await Promise.all([
    prisma.order.findUnique({ where: { id: order.id }, select: EARNING_ORDER_SELECT }),
    prisma.salesRep.findUnique({ where: { user_id: repId }, select: { commission_pct: true } }),
    // The same test editOrder refuses on, so the page and the refusal agree.
    issuedFacturaFor(prisma, order),
  ]);
  const earning = earningOrder ? repEarningView(earningOrder, rep?.commission_pct ?? null) : null;

  return success(res, { ...order, factura_issued: !!factura, sibling_orders: siblings, earning });
}));

// ─── POST /api/sales/orders ─────────────────────────────
//
// The same flow staff use, through lib/createOrder. `admin_notes` is absent
// from this schema — an internal ops note is not a rep's field — and the
// client must be in the rep's book, checked here rather than inside the shared
// function because the scope is a property of this namespace, not of order
// creation.
const createOrderSchema = z.object({
  ...createOrderCoreShape,
  admin_notes: z.undefined(),
  /** A Home Grocery order for an approved household in their book: its slot. */
  home_grocery: slotSchema.optional(),
});

router.post('/', validate(createOrderSchema), asyncHandler(async (req, res) => {
  const { home_grocery: slot, ...body } = req.body as z.infer<typeof createOrderSchema>;
  const repId = req.salesRep!.user.id;

  /**
   * Their reach (lib/repClients): an account they opened, one they have
   * already built an order for, or one they found by its exact email — and
   * ordering for somebody else's client leaves it theirs. Same definition as
   * routes/sales/clients.ts, and the same reason — a rep's device must not be
   * able to reach the whole customer base.
   *
   * 404, not 403: confirming that an id they cannot see exists is itself the
   * leak the scope exists to prevent.
   */
  const inReach = await prisma.user.findFirst({
    where: { AND: [{ id: body.user_id }, reachOf(repId)] },
    select: { id: true },
  });
  if (!inReach) return error(res, 'Client not found.', 404);

  // From the rep's shops only (lib/repStore). None assigned, or none that
  // can be sold from, builds nothing; a product from any other shop is
  // refused by name. The screens offer neither — this is the enforcement.
  const shop = req.salesRep!.rep.store;
  if (!sellsFrom(shop)) return error(res, noStoreMessage(shop), 422, { code: REP_NO_STORE });
  const outside = await productsOutsideRepStore(shop, body.items.map((i) => i.variant_id));
  if (outside.length > 0) {
    return error(res, `Not from your shops: ${outside.join(', ')}.`, 422, { code: REP_OUTSIDE_STORE, products: outside });
  }

  // A rep keys the order in for the household, the way staff do: today is a
  // day they can deliver on.
  // Every order of a household with a plan is one of its Home Grocery
  // orders (2026-10-23): the slot sent, or the plan's default one.
  let hg: Awaited<ReturnType<typeof homeGroceryFieldsFor>> = null;
  try {
    hg = await homeGroceryFieldsFor(body.user_id, slot, { staff: true });
  } catch (err) {
    if (err instanceof PlanError) return error(res, err.message, err.status);
    throw err;
  }

  // Read back through GET /api/orders/progress/:key — a rep is a user.
  const progress = trackProgress(req, res, `user:${repId}`, 'create', { txBudgetMs: 8_000 });
  try {
    const result = await createOrderForCustomer({ ...body, ...hg?.fields }, { salesRepId: repId }, {
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
    // The client hears they have an order, and the office that it has one
    // to fulfil. A parked draft waits until it takes its stock.
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

// ─── Acting on an order they built ──────────────────────
//
// WHAT IS HERE IS THE REP'S OWN WORK. Editing the basket, cancelling, taking
// the stock for a draft they parked, the delivery fee they were already
// allowed to waive while building, and the client's note. Each is something
// they would otherwise ring the office about for an order they made ten
// seconds ago.
//
// WHAT IS NOT HERE IS SOMEBODY ELSE'S JOB, and its absence IS the permission —
// there is no endpoint to reach, not a hidden button:
//
//   · No DELETE. The destructive path, and the one a rep is least placed to
//     judge: they see their own orders, not whether ops has already picked
//     this one.
//   · No RIDER assignment. A rep does not know who is free.
//   · No INVOICE issuing. A factura is a fiscal document with gap-free
//     numbering. It is issued once and cannot be unissued.
//   · No STATUS march. confirmed → preparing → on_the_way is fulfilment
//     saying where the goods are; a rep marking "delivered" from a shop
//     counter would be stating something they cannot know.
//
// Cancelling is the one status change they do get, because it is the one that
// is genuinely theirs: the client standing in front of them changed their mind.
//
// Every handler re-scopes by `created_by_sales_rep_id` rather than trusting the
// id in the URL, and answers 404 rather than 403 for the same reason the client
// routes do — confirming an id exists is itself the leak.

/** Their order, or nothing. The rep id is part of the lookup, not a check
 *  applied after it. */
async function ownOrder(orderId: string, repId: string) {
  return prisma.order.findFirst({
    where: { id: orderId, created_by_sales_rep_id: repId, deleted_at: null },
    select: { id: true, status: true, parent_order_id: true },
  });
}

// ─── PUT /api/sales/orders/:id/items ────────────────────
// Admin's schema, unchanged — the rep edit modal is admin's modal, so it
// sends admin's operations.
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
    // Flat euros off one line. Capped far above any plausible line so a typo
    // cannot wreck an order, and 0 is how the UI clears it.
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
  const repId = req.salesRep!.user.id;

  if (!(await ownOrder(req.params.id, repId))) return error(res, 'Order not found.', 404);

  // What is added comes from the rep's shops (lib/repStore). Lines already
  // on the order from elsewhere stay — changing, discounting or removing them
  // is still the rep's to do — but nothing new comes in from any other shop.
  const adding = operations.flatMap((op) => (op.action === 'add' || op.action === 'replace' ? [op.new_variant_id] : []));
  if (adding.length > 0) {
    const shop = req.salesRep!.rep.store;
    if (!sellsFrom(shop)) return error(res, noStoreMessage(shop), 422, { code: REP_NO_STORE });
    const outside = await productsOutsideRepStore(shop, adding);
    if (outside.length > 0) {
      return error(res, `Not from your shops: ${outside.join(', ')}.`, 422, { code: REP_OUTSIDE_STORE, products: outside });
    }
  }

  const progress = trackProgress(req, res, `user:${repId}`, 'edit', { txBudgetMs: 8_000 });
  const result = await editOrder(
    req.params.id,
    operations,
    // Its own actor, not `admin` with a null id and not `customer`. The first
    // would say an admin did it and name nobody; the second reads as the client
    // changing their own order, which is the opposite of what happened.
    { type: 'sales_rep', salesRepId: repId },
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
    // The shortfalls ride along as DATA, not only inside the sentence.
    // Creating an order answers this way (see createOrder.ts), and the edit
    // screen is now the same screen — so it renders the same per-product
    // "need 8, have 3" list from the same shape, instead of parsing a string
    // somebody will reword.
    return error(
      res,
      `Not enough stock: ${result.shortfalls.map((sf) => `${sf.productName} (need ${sf.needed}, have ${sf.available})`).join('; ')}`,
      400,
      { shortfalls: result.shortfalls },
    );
  }
  // An issued invoice freezes this order's contents. editOrder() refuses
  // rather than letting the two disagree, and the correction is a credit note
  // — which is not a rep's to issue, hence the different ending.
  if (result.status === 'invoiced') {
    return error(res, 'The office has already invoiced this order. Ask them to correct it.', 409);
  }

  // A DRAFT TELLS NOBODY (2026-11-04). The client has not heard of it yet — a
  // parked order is announced when its stock is confirmed — and an order a rep
  // built never splits, so there is no new part for the office either.
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

  // A cross-store add spun off another order. Ops hears about it the same way
  // checkout tells them about any new one. The rep is told too — the new part
  // inherits their id, so it is theirs to open, and the edit screen names it
  // on the way out.
  for (const n of result.newOrders) {
    void notifyAdminNewOrder({
      orderId: n.id,
      orderNumber: n.order_number,
      customerName: null,
      total: n.total,
    });
  }

  return success(res, { order: result.order, newOrders: result.newOrders });
}));

// ─── PUT /api/sales/orders/:id/cancel ───────────────────
//
// Its own route rather than a status endpoint taking any value. A route that
// accepts a status is a route that can be sent 'delivered', and then the only
// thing between a rep and marking goods delivered from a counter is a zod enum
// somebody has to remember to keep narrow.
const cancelSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

router.put('/:id/cancel', validate(cancelSchema), asyncHandler(async (req, res) => {
  const { reason } = req.body as z.infer<typeof cancelSchema>;
  const repId = req.salesRep!.user.id;

  const mine = await ownOrder(req.params.id, repId);
  if (!mine) return error(res, 'Order not found.', 404);
  if (mine.status === 'cancelled') return error(res, 'That order is already cancelled.', 422);
  // Once it is moving it is ops' call: cancelling an order a rider is carrying
  // does not stop the rider.
  if (mine.status === 'on_the_way' || mine.status === 'delivered') {
    return error(res, 'That order has already gone out. Ask the office to cancel it.', 422);
  }
  // A factura outlives a cancellation: it stays valid and owed until a credit
  // note corrects it, and only the office can issue one. So does the partner's
  // route refuse, and the same test as editing an invoiced order.
  if (await issuedFacturaFor(prisma, mine)) {
    return error(res, 'The office has already invoiced this order. Ask them to cancel it.', 409);
  }

  const progress = trackProgress(req, res, `user:${repId}`, 'cancel', { txBudgetMs: 8_000 });
  const updated = await prisma.$transaction(async (tx) => {
    progress.txStart();
    const order = await tx.order.findUnique({
      where: { id: req.params.id },
      include: { items: true },
    });
    if (!order) return null;
    progress.detail({ lines: order.items.length });

    // A DRAFT RESERVED NOTHING, so there is nothing to give back. Restocking
    // one would invent stock out of an order that never held any — the same
    // rule cancel and delete follow everywhere else in this codebase.
    if (order.status !== 'draft') await restockItems(tx, order.items);

    return tx.order.update({
      where: { id: order.id },
      data: { status: 'cancelled', cancelled_reason: reason ?? null },
    });
  }, {
    // The budget every order transaction carries: Neon suspends an idle
    // compute and the wake-up lands inside the transaction. Cancelling also
    // restocks, so this is not the plain status flip it looks like.
    maxWait: 5_000,
    timeout: 8_000,
  });
  progress.txEnd();
  progress.step('confirming');

  if (!updated) return error(res, 'Order not found.', 404);

  void notifyOrderStatusChange({
    userId: updated.user_id,
    orderId: updated.id,
    orderNumber: updated.order_number,
    status: 'cancelled',
    reason: reason ?? null,
    // They cancelled it themselves: their own bell stays quiet.
    actorRepId: req.salesRep!.user.id,
  });
  // A Home Grocery plan delivery that settles makes the plan's next one.
  void afterPlanOrderChange(updated.id);
  // Noted on their earnings as not earned (lib/repEarnings).
  void settleRepEarning(updated.id);

  return success(res, updated);
}));

// ─── POST /api/sales/orders/:id/confirm-stock ───────────
//
// A draft holds nothing. This is the moment it becomes real and takes its
// stock — the decision the rep parked it to make later. It lands on `pending`,
// not `confirmed`: resolving stock and accepting the order are different
// decisions, and the second is still ops'.
router.post('/:id/confirm-stock', asyncHandler(async (req, res) => {
  const repId = req.salesRep!.user.id;
  if (!(await ownOrder(req.params.id, repId))) return error(res, 'Order not found.', 404);

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
      `Still short on stock: ${result.shortfalls.map((sf) => `${sf.productName} (need ${sf.needed}, have ${sf.available})`).join('; ')}`,
      409,
    );
  }

  // The parked basket is a real order now — the first the client or the
  // office hears of it.
  void announceOrderBuiltForCustomer({ orderId: result.order.id });
  void afterPlanDraftConfirmed(result.order.id);

  return success(res, result.order);
}));

// ─── PUT /api/sales/orders/:id/delivery-fee ─────────────
//
// The fee is a judgement and has to stay one after the order exists: a rep sets
// it at the counter from what the load looks like, and the load changes. They
// could already waive it while building, so being unable to afterwards would
// mean rebuilding an order to fix one number.
const deliveryFeeSchema = z.object({
  delivery_fee: z.number().nonnegative().max(1000),
});

router.put('/:id/delivery-fee', validate(deliveryFeeSchema), asyncHandler(async (req, res) => {
  const { delivery_fee: fee } = req.body as z.infer<typeof deliveryFeeSchema>;
  const repId = req.salesRep!.user.id;

  if (!(await ownOrder(req.params.id, repId))) return error(res, 'Order not found.', 404);

  const order = await prisma.order.findUnique({
    where: { id: req.params.id },
    select: {
      id: true, status: true, subtotal: true, parent_order_id: true, deleted_at: true,
      user_id: true, order_number: true, delivery_fee: true, recargo_equivalencia: true,
      // Whether a draft is one our team built, which the rep may change (isEditableDraft).
      created_by_admin_id: true, created_by_sales_rep_id: true, rashan_subscription_id: true,
      // ONLY A FACTURA LOCKS. An albarán is not a fiscal document.
      invoices: { where: { status: 'issued', kind: 'invoice' }, select: { invoice_number: true } },
    },
  });
  if (!order) return error(res, 'Order not found.', 404);

  // Shared with the admin and partner routes so the three can never drift on
  // WHEN a fee may change; the wording below is this route's own.
  const blocked = deliveryFeeBlocker(order, { draftOk: isEditableDraft(order) });
  if (blocked?.kind === 'not_editable') {
    return error(
      res,
      'The delivery fee can only be changed while an order is pending, confirmed or preparing, or still a draft.',
      422,
    );
  }
  if (blocked?.kind === 'invoiced') {
    return error(res, 'The office has already invoiced this order. Ask them to correct it.', 409);
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
    data: await orderFeeData(prisma, order, fee),
    select: { id: true, subtotal: true, delivery_fee: true, recargo: true, total: true },
  });
  // Not for a draft: the client has not been told about that order yet.
  if (order.status === 'draft') return success(res, updated);
  void notifyDeliveryFeeSet({
    userId: order.user_id, orderId: order.id, orderNumber: order.order_number,
    before: Number(order.delivery_fee), after: Number(updated.delivery_fee), total: Number(updated.total),
  });
  return success(res, updated);
}));

// ─── PUT /api/sales/orders/:id/notes ────────────────────
//
// The CLIENT's note — "leave it with the neighbour" — not the internal ops one.
// The same field the rep filled in while building, so fixing a typo does not
// mean rebuilding the order. `admin_notes` stays absent from every rep schema.
const notesSchema = z.object({
  customer_notes: z.string().max(2000),
});

router.put('/:id/notes', validate(notesSchema), asyncHandler(async (req, res) => {
  const { customer_notes: notes } = req.body as z.infer<typeof notesSchema>;
  const repId = req.salesRep!.user.id;

  if (!(await ownOrder(req.params.id, repId))) return error(res, 'Order not found.', 404);

  const order = await prisma.order.update({
    where: { id: req.params.id },
    data: { customer_notes: notes },
    select: { id: true, customer_notes: true },
  });
  return success(res, order);
}));

// ─── POST /api/sales/orders/:id/invoice ─────────────────
//
// An ALBARÁN, for an order the rep built. Never a factura.
//
// THE LINE IS FISCAL, NOT VISUAL. An albarán prints exactly like a factura
// with ALBARÁN as its title (2026-11-05) — but it is not a fiscal document: a
// priced statement of what was agreed, reissued whenever the order changes,
// which is exactly what a rep in front of a client needs to hand over. A
// factura is the fiscal one: it closes the order to further documents, states
// totals that cannot be altered, and is corrected only by a credit note. That
// belongs with the office alone: a rep neither makes nor reads one (2026-11-07).
//
// `kind` is still accepted so asking for a factura gets an explanation rather
// than a schema error from a field that quietly only takes one value.
//
// The 422 carries the blockers as DATA as well as prose, because the answer
// is a list of things to go and fix on other screens and the rep needs to
// read it rather than watch it fade.
const draftDocSchema = z.object({
  kind: z.enum(['albaran', 'invoice']).optional(),
}).strict();

router.post('/:id/invoice', validate(draftDocSchema), asyncHandler(async (req, res) => {
  const { kind } = req.body as z.infer<typeof draftDocSchema>;
  const repId = req.salesRep!.user.id;

  if (kind === 'invoice') {
    return error(
      res,
      'Facturas are handled by the office. You can create an albarán or download the bill.',
      403,
      { kind_allowed: 'albaran' },
    );
  }

  const own = await ownOrder(req.params.id, repId);
  if (!own) return error(res, 'Order not found.', 404);

  /**
   * A PART of a split purchase has no document of its own.
   *
   * The client made one purchase, so billing per shop would hand them three
   * albaranes for one basket. The documents belong to the parent, and the
   * screens send the rep there — this refuses the request that would produce
   * exactly the thing that rule exists to stop.
   */
  if (own.parent_order_id) {
    return error(
      res,
      'This order is part of a larger purchase. The documents belong to the whole purchase.',
      409,
      { parent_order_id: own.parent_order_id },
    );
  }

  const result = await draftInvoice({
    subjectId: own.id,
    // Named, not derived. Left to the blockers, an invoiceable order would
    // have been handed a factura the rep never asked for and cannot undo.
    requestedKind: 'albaran',
    actor: { salesRepId: repId },
  });

  if (result.status === 'not_found') return error(res, 'Order not found.', 404);
  if (result.status === 'blocked') {
    // Without `existing`: that is the issued factura's id and number. Only what
    // stops an albarán, too: the rest is about a factura, and the office's.
    return error(res, result.message, 422, { blockers: result.blockers.filter((b) => !b.albaran_ok) });
  }
  // Not the lines the office left off the document (2026-11-04): a rep's
  // screens print only `lines`, so the hidden ones are not theirs to receive.
  const { hidden_lines: _left, ...invoice } = result.invoice;
  return success(
    res,
    { invoice, blockers: result.blockers.filter((b) => !b.albaran_ok), kind: result.kind },
    result.created ? 201 : 200,
  );
}));

export default router;
