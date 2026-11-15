import { Prisma, type DeliveryWindow } from '@prisma/client';
import type { ProgressTracker } from './orderProgress';
import { MAX_ORDER_LINES, MAX_LINE_QUANTITY } from './orderLimits';
import { z } from 'zod';
import prisma from './prisma';
import { generateOrderNumber } from './pagination';
import { getDeliveryPricing, resolveDeliveryFee } from './delivery-pricing';
import { effectiveUnitPrice, lineVatSnapshot, pricingForAccount } from './pricing';
import { computeOrderTotals, lineTotal, lineDiscountFromUnit, buildProductSnapshot } from './orderTotals';
import { rememberDiscounts, savedDiscountsFor, statedUnitDiscount } from './customerDiscounts';
import { audienceOf, isShownTo } from './audience';

/**
 * Building an order FOR a customer, rather than one they placed themselves.
 *
 * Two callers: staff in the admin panel (POST /api/admin/orders) and a sales
 * rep in the field (POST /api/sales/orders). Same act, same rules, and the
 * rules are the kind you only want to state once:
 *
 *   1. It creates at `pending` unless the builder parks it, and `draft` keeps
 *      the one meaning it has everywhere else: stock was deliberately NOT
 *      reserved (lib/draftOrders.ts). Placing an order reserves the goods;
 *      parking an unfinished basket does not, and POST /:id/confirm-stock is
 *      what takes the stock when the draft becomes real. Decrementing here as
 *      well would double-charge it on confirm, and hand back stock that was
 *      never held on a cancel — cancelling and deleting both skip the restock
 *      for a draft precisely because a draft holds nothing.
 *
 *   2. Insufficient stock is a hard block, returned in editOrder's exact
 *      `shortfalls` shape so the UI can reuse the renderer. No draft split —
 *      someone at a counter needs "only 3 left", not an order that silently
 *      became two orders under a ParentOrder.
 *
 *   3. It stays ONE order whatever shops the products come from, and that
 *      order belongs to Cesto (`store_id` null). We deliver what we sell this
 *      way, so no partner is fulfilling anything and there is nothing to
 *      split — the opposite of a customer checkout, where each shop picks
 *      and packs its own part.
 *
 * Pricing comes from the CUSTOMER, never from the request, which is also why
 * this cannot be a thin wrapper over the storefront checkout.
 */

/**
 * A shop restocking is a genuinely large order — a hundred lines is ordinary,
 * not an abuse — and the work below is a fixed number of queries whatever the
 * count, so the cap is about keeping one request bounded rather than about
 * what the transaction can survive.
 *
 * It was 300 while the customer's cart was raised to 1000, which left the rep
 * — the likeliest source of a big order — with the tightest ceiling of
 * anyone. One number now, in lib/orderLimits.ts.
 */
export const orderItemsSchema = z.array(z.object({
  variant_id: z.string().uuid(),
  // Stock is the real limit and is checked below; this only stops a typo.
  quantity: z.number().int().positive().max(MAX_LINE_QUANTITY),
  /**
   * Flat euros off this line — never a percentage, never per unit, matching
   * OrderItem.discount_amount and the `set_discount` edit operation.
   *
   * Creating an order could not carry one until 2026-10-10: a rep who agreed
   * a price at the counter had to place the order and then edit it, which
   * wrote a discount into the edit log as though they had changed their mind
   * afterwards. The cap mirrors the edit route's.
   */
  discount_amount: z.number().min(0).max(100000).optional(),
  /**
   * Euros off ONE unit (2026-10-25): the discount as staff and reps now enter
   * it. When present it decides the line — `discount_amount` becomes this
   * times the quantity — and it is REMEMBERED for this customer and product
   * size (lib/customerDiscounts): a positive figure saves it, zero forgets it.
   *
   * Absent means the client said nothing: a client from before per-unit
   * discounts, whose flat `discount_amount` applies as it always did, or none
   * at all, in which case the customer's saved discount applies.
   */
  unit_discount: z.number().min(0).max(100000).optional(),
})).min(1).max(MAX_ORDER_LINES);

/** The fields both callers send. */
export const createOrderCoreShape = {
  user_id: z.string().uuid(),
  address_id: z.string().uuid(),
  // Accepted but never offered — see routes/orders.ts.
  payment_method: z.enum(['cod', 'card', 'bizum']).default('cod'),
  items: orderItemsSchema,
  /** Omit to let the server price it from settings + the address. */
  delivery_fee: z.number().nonnegative().max(1000).optional(),
  /**
   * Park the order instead of placing it. Only 'draft' is accepted — someone
   * saving a half-built basket should not be able to hand it any other
   * status, and 'pending' is already what omitting this means.
   */
  status: z.literal('draft').optional(),
  customer_notes: z.string().max(2000).optional(),
};

export type CreateOrderInput = {
  user_id: string;
  address_id: string;
  payment_method: 'cod' | 'card' | 'bizum';
  /** `unit_discount` is euros off one unit; `discount_amount` the older flat figure — see orderItemsSchema. */
  items: Array<{ variant_id: string; quantity: number; discount_amount?: number; unit_discount?: number }>;
  delivery_fee?: number;
  status?: 'draft';
  customer_notes?: string;
  admin_notes?: string;
  /**
   * INTERNAL ONLY — no HTTP schema carries these, so no request can set them.
   * A Home Grocery order: the household's plan, and its slot — the day and
   * the part of the day. Routes resolve them through lib/homeGroceryPlan.ts
   * (homeGroceryOrderFields), never from the request body directly.
   */
  rashan_subscription_id?: string;
  scheduled_for?: Date;
  delivery_window?: DeliveryWindow | null;
};

/**
 * Who built it. Exactly one side is set — lib/orderSource explains why there
 * are two columns rather than one.
 */
export type OrderCreator = {
  adminId?: string | null;
  salesRepId?: string | null;
};

/**
 * A refusal the caller renders as-is. Carries the HTTP status and the detail
 * payload, because the shortfall list is the whole value of a stock refusal:
 * "not enough stock" without "only 3 left" sends someone back to count shelves.
 */
export class CreateOrderError extends Error {
  constructor(
    message: string,
    public status: number,
    public detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'CreateOrderError';
  }
}

/** Thrown when the in-transaction stock re-check loses a race. */
class StockRaceError extends Error {
  constructor(public productName: string, public needed: number, public available: number) {
    super(`Insufficient stock for "${productName}"`);
  }
}

export type CreateOrderResult = {
  order: Prisma.OrderGetPayload<{ include: { items: true } }>;
  /** What the rules priced it at, before any override. Both are returned so
   *  the UI can say which applied. */
  deliveryFeeResolved: string;
  deliveryFeeApplied: string;
  /**
   * True when this request carried the key of an order already built, and
   * that order is what came back. Nothing was created, so the caller answers
   * 200 rather than 201 and announces nothing: the client heard once.
   */
  replayed?: boolean;
};

/**
 * The order an earlier request with this key already built, or null.
 *
 * WHY ADMIN AND THE REP NEED THIS. Their screens used to give up after 10s
 * with no key, while the server may take longer: a connection queue (up to
 * 5s) plus the transaction (up to 8s). When the screen lost that race the
 * order existed anyway, the admin or rep was told it had failed, pressed
 * again, and the client got a second real order. The customer checkout was
 * fixed for exactly this on 2026-10-10 (routes/orders.ts, replayCheckout);
 * this is the same fix for orders built for a customer.
 *
 * Scoped to the CUSTOMER the order is for, like the checkout's: the same
 * order_idempotency table, keyed (user_id, key). And only handed back to the
 * same side that built it, a rep their own order and an admin an admin's.
 * A key that names somebody else's order is refused, not served.
 */
async function replayBuiltOrder(
  customerId: string,
  key: string,
  creator: { adminId: string | null; salesRepId: string | null },
): Promise<CreateOrderResult | null> {
  const prior = await prisma.orderIdempotency.findUnique({
    where: { user_id_key: { user_id: customerId, key } },
  });
  if (!prior?.order_id) return null;
  const order = await prisma.order.findUnique({ where: { id: prior.order_id }, include: { items: true } });
  if (!order) return null;
  // Three builders: a rep (that rep), staff (any of them), or the household
  // itself — a Home Grocery order from its plan page, built by nobody else.
  const sameBuilder = creator.salesRepId
    ? order.created_by_sales_rep_id === creator.salesRepId
    : creator.adminId
      ? order.created_by_admin_id !== null
      : order.created_by_admin_id === null && order.created_by_sales_rep_id === null;
  if (!sameBuilder) throw new CreateOrderError('That request was already used for another order.', 409);
  const fee = order.delivery_fee.toString();
  return { order, deliveryFeeResolved: fee, deliveryFeeApplied: fee, replayed: true };
}

type VariantForPricing = Prisma.ProductVariantGetPayload<{
  include: { product: { include: { images: true } } };
}>;

/**
 * Loaded the way pricing needs them: product and its first image — and the
 * buying price, asked for by name (lib/prisma omits it), which the line copies.
 */
function loadVariantsForPricing(ids: string[]) {
  return prisma.productVariant.findMany({
    where: { id: { in: ids } },
    omit: { cost_price: false },
    include: { product: { include: { images: { orderBy: { sort_order: 'asc' }, take: 1 } } } },
  });
}

/**
 * The order lines for a set of items, priced for this buyer.
 *
 * One implementation for creating an order and for rewriting a draft (a Home
 * Grocery delivery being kept in step with its plan), so the two can never
 * price the same basket differently.
 */
function priceLines(
  items: Array<{ variant_id: string; quantity: number; discount_amount?: number; unit_discount?: number }>,
  byId: Map<string, VariantForPricing>,
  pricingCtx: ReturnType<typeof pricingForAccount>,
  /** This customer's saved discounts (variant id → euros off one unit). */
  saved: Map<string, Prisma.Decimal> = new Map(),
) {
  return items.map((item) => {
    const v = byId.get(item.variant_id)!;
    // With the product's IVA (lib/pricing), which the line records beside it.
    const unit = effectiveUnitPrice(v, pricingCtx, v.product);
    /**
     * Which discount, in order: the per-unit one the line states; else a
     * flat line figure from a client that predates per-unit discounts; else
     * the one this customer has saved for this product size.
     *
     * Null rather than 0 for a line nobody discounted, which is the column's
     * own convention: "never discounted" and "discounted by nothing" stay
     * distinguishable, and the edit log depends on that distinction.
     */
    const stated = statedUnitDiscount(item.unit_discount);
    let unitDiscount: Prisma.Decimal | null;
    let discount: Prisma.Decimal | null;
    if (stated !== undefined) {
      unitDiscount = stated;
      discount = lineDiscountFromUnit(stated, item.quantity);
    } else if (item.discount_amount != null && item.discount_amount > 0) {
      unitDiscount = null;
      discount = new Prisma.Decimal(item.discount_amount);
    } else {
      unitDiscount = saved.get(v.id) ?? null;
      discount = lineDiscountFromUnit(unitDiscount, item.quantity);
    }
    return {
      product_id: v.product_id,
      variant_id: v.id,
      product_snapshot: buildProductSnapshot(v),
      quantity: item.quantity,
      unit_price: unit,
      discount_amount: discount,
      unit_discount: unitDiscount,
      // Clamped at zero inside lineTotal, and clamped the same way when the
      // line is edited later — one implementation, so the two agree.
      line_total: lineTotal({ unit_price: unit, quantity: item.quantity, discount_amount: discount }),
      // The size's buying price as it stands now; the order's own from here.
      unit_cost: v.cost_price,
      // The IVA this price was charged with, so a band changed later never
      // re-splits it.
      ...lineVatSnapshot(v.product),
    };
  });
}

function addressSnapshot(address: {
  contact_name: string; contact_phone: string; street_line_1: string; street_line_2: string | null;
  postcode: string; city: string; province: string; delivery_notes: string | null;
}) {
  return {
    contact_name: address.contact_name,
    contact_phone: address.contact_phone,
    street_line_1: address.street_line_1,
    street_line_2: address.street_line_2,
    postcode: address.postcode,
    city: address.city,
    province: address.province,
    delivery_notes: address.delivery_notes,
  };
}

export async function createOrderForCustomer(
  body: CreateOrderInput,
  creator: OrderCreator,
  opts: {
    /** Same key on a retry = the same order back, not a second one. */
    idempotencyKey?: string | null;
    progress?: ProgressTracker;
    /**
     * Make the draft even if stock is short today. Only honoured for a draft,
     * which takes no stock: a Home Grocery delivery is made weeks ahead, and
     * stock is checked when staff confirm it (POST /:id/confirm-stock).
     */
    allowShortStock?: boolean;
    /**
     * More writes that must commit or roll back with the order — a Home
     * Grocery checkout empties the household's cart here, so an order that
     * rolls back leaves the cart as it was, and one that commits never
     * leaves it full.
     */
    inTransaction?: (tx: Prisma.TransactionClient) => Promise<void>;
  } = {},
): Promise<CreateOrderResult> {
  const progress = opts.progress;
  progress?.detail({ lines: body.items.length });
  const adminId = creator.adminId ?? null;
  const salesRepId = creator.salesRepId ?? null;
  /** Parked, not placed. Decides whether any stock is taken at all. */
  const isDraft = body.status === 'draft';
  const idempotencyKey = opts.idempotencyKey?.trim().slice(0, 255) || null;

  // Answered FIRST, before any check: the stock the first request took may be
  // exactly what would make this one fail a shortfall check.
  if (idempotencyKey) {
    const already = await replayBuiltOrder(body.user_id, idempotencyKey, { adminId, salesRepId });
    if (already) return already;
  }

  const [customer, address] = await Promise.all([
    prisma.user.findUnique({
      where: { id: body.user_id },
      select: { id: true, status: true, is_business: true, pricing_mode: true, recargo_equivalencia: true },
    }),
    prisma.address.findUnique({ where: { id: body.address_id } }),
  ]);

  if (!customer) throw new CreateOrderError('Customer not found.', 404);
  if (customer.status === 'blocked') {
    throw new CreateOrderError('This customer is blocked. Unblock them before placing an order.', 422);
  }
  if (!address || address.user_id !== customer.id) {
    throw new CreateOrderError('That address does not belong to this customer.', 422);
  }

  const variantIds = [...new Set(body.items.map((i) => i.variant_id))];
  const variants = await loadVariantsForPricing(variantIds);
  const byId = new Map(variants.map((v) => [v.id, v]));

  const missing = variantIds.filter((id) => !byId.has(id));
  if (missing.length > 0) throw new CreateOrderError('One of those products no longer exists.', 422);

  const inactive = variants.filter((v) => !v.is_active || !v.product.is_active);
  if (inactive.length > 0) {
    throw new CreateOrderError(`"${inactive[0].product.name_es}" is no longer on sale.`, 422);
  }
  // A customer's OWN order (no builder) cannot carry a product they are not
  // shown — B2C only, B2B only (lib/audience). Staff and reps may: their
  // panels follow the customer's kind, but a deliberate exception stays theirs.
  if (!adminId && !salesRepId && customer) {
    const kind = audienceOf(customer);
    const hidden = variants.filter((v) => !isShownTo(v.product.audience, kind));
    if (hidden.length > 0) {
      throw new CreateOrderError(`"${hidden[0].product.name_es}" is not available for your account.`, 422);
    }
  }

  // Quantities netted per variant first: the same variant can appear twice in
  // the payload, and checking each line separately would let a basket of
  // 3 + 3 through against a stock of 5.
  const wanted = new Map<string, number>();
  for (const item of body.items) {
    wanted.set(item.variant_id, (wanted.get(item.variant_id) ?? 0) + item.quantity);
  }

  const shortfalls: Array<{ productName: string; needed: number; available: number }> = [];
  for (const [variantId, needed] of wanted) {
    const v = byId.get(variantId)!;
    if (v.stock_quantity < needed) {
      shortfalls.push({ productName: v.product.name_es, needed, available: v.stock_quantity });
    }
  }
  if (shortfalls.length > 0 && !(isDraft && opts.allowShortStock)) {
    throw new CreateOrderError('Not enough stock for some items.', 400, { shortfalls });
  }

  // Priced from the CUSTOMER'S ACCOUNT, never from the request — and not from
  // their storefront toggle either: a business is sold to at wholesale. See
  // pricingForAccount for why the toggle priced rep-built orders at retail.
  const pricingCtx = pricingForAccount(customer);

  // Their saved discounts, for lines that state none (lib/customerDiscounts).
  const saved = await savedDiscountsFor(customer.id, variantIds);
  const lines = priceLines(body.items, byId, pricingCtx, saved);

  const pricing = await getDeliveryPricing();
  const resolved = resolveDeliveryFee({
    subtotal: lines.reduce((s2, l) => s2.plus(l.line_total), new Prisma.Decimal(0)),
    pricing,
    destination: address.latitude != null && address.longitude != null
      ? { lat: address.latitude, lng: address.longitude }
      : null,
    // A wholesale client ordering through an admin or a rep is still a
    // wholesale client. The explicit override below still wins, so a rep can
    // put a fee back on when a particular drop earns one.
    buyerIsBusiness: customer.is_business,
  });
  // An explicit fee overrides the resolved one — waiving delivery is a real
  // thing a rep does. Both are returned so the UI can say which applied.
  const deliveryFee = body.delivery_fee !== undefined
    ? new Prisma.Decimal(body.delivery_fee)
    : resolved.fee;

  // Recargo de equivalencia when the customer is under the regime (2026-11-04).
  const totals = computeOrderTotals(lines, deliveryFee, { recargo: customer.recargo_equivalencia });

  let order;
  try {
    order = await prisma.$transaction(async (tx) => {
      progress?.txStart();
      // Re-check inside the transaction: the stock read above is outside it, so
      // a concurrent checkout could have taken the last unit in between.
      const fresh = await tx.productVariant.findMany({
        where: { id: { in: [...wanted.keys()] } },
        select: { id: true, stock_quantity: true, product: { select: { name_es: true } } },
      });
      for (const v of fresh) {
        const needed = wanted.get(v.id)!;
        if (v.stock_quantity < needed) {
          throw new StockRaceError(v.product.name_es, needed, v.stock_quantity);
        }
      }

      // One statement, not one per variant.
      //
      // This was a sequential `update` per distinct variant inside an
      // 8-second transaction. A shop restocking eighty products meant eighty
      // serial round-trips to Neon before the order row was even written,
      // and the rep saw a failed order after the whole thing had already
      // started rolling back. Now it is a single UPDATE whatever the size.
      //
      // Sorted by id so concurrent transactions touching overlapping
      // baskets take the row locks in the same order, which is what keeps
      // two simultaneous large orders from deadlocking each other.
      //
      // A DRAFT TAKES NOTHING. `draft` means one thing across this codebase —
      // stock was deliberately not reserved — and the three places that read
      // it all rely on that: cancelling skips the restock, deleting skips it,
      // and POST /:id/confirm-stock decrements when the draft becomes real.
      // A draft that had already taken its stock would be given back stock it
      // never held on a cancel, and charged twice for it on a confirm.
      // Parking an unfinished basket is not a claim on the goods; pressing
      // Create is.
      progress?.step('reserving');
      if (!isDraft) {
        const decrements = [...wanted.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
        await tx.$executeRaw`
          UPDATE product_variants AS v
             SET stock_quantity = v.stock_quantity - d.qty
            FROM (VALUES ${Prisma.join(
              decrements.map(([id, qty]) => Prisma.sql`(${id}::uuid, ${qty}::int)`),
            )}) AS d(id, qty)
           WHERE v.id = d.id
        `;
      }

      progress?.step('creating');
      const created = await tx.order.create({
        data: {
          // The account type at the moment it was built — see
          // Order.buyer_is_business.
          buyer_is_business: customer.is_business,
          order_number: generateOrderNumber(),
          user_id: customer.id,
          address_id: address.id,
          address_snapshot: addressSnapshot(address),
          payment_method: body.payment_method,
          // Always Cesto, never the product's shop. We deliver this
          // ourselves, so no partner is fulfilling it and it must not show
          // up in anyone's partner dashboard. Products from any number of
          // shops sit together in this one order.
          store_id: null,
          created_by_admin_id: adminId,
          created_by_sales_rep_id: salesRepId,
          status: body.status ?? 'pending',
          subtotal: totals.subtotal,
          delivery_fee: totals.delivery_fee,
          // The regime as it stands now, copied: switching the customer later
          // moves no order already placed.
          recargo_equivalencia: customer.recargo_equivalencia,
          recargo: totals.recargo,
          total: totals.total,
          customer_notes: body.customer_notes ?? null,
          admin_notes: body.admin_notes ?? null,
          rashan_subscription_id: body.rashan_subscription_id ?? null,
          scheduled_for: body.scheduled_for ?? null,
          delivery_window: body.delivery_window ?? null,
          items: { createMany: { data: lines } },
        },
        include: { items: true },
      });
      // Inside the transaction, so the primary key arbitrates a race: two
      // requests with one key cannot both commit, and the loser is rolled
      // back, stock included, and sent to the replay below.
      if (idempotencyKey) {
        await tx.orderIdempotency.create({
          data: { user_id: customer.id, key: idempotencyKey, order_id: created.id },
        });
      }
      // What staff or a rep said about each line's discount is remembered for
      // this customer — inside the transaction, so an order that rolls back
      // changes nothing. A customer's own order (no builder) only reads them.
      if (adminId || salesRepId) {
        await rememberDiscounts(
          tx,
          customer.id,
          body.items
            .filter((i) => i.unit_discount !== undefined)
            .map((i) => ({
              variantId: i.variant_id,
              productId: byId.get(i.variant_id)!.product_id,
              amount: statedUnitDiscount(i.unit_discount) ?? null,
            })),
          { orderId: created.id, adminId, salesRepId },
        );
      }
      if (opts.inTransaction) await opts.inTransaction(tx);
      return created;
      // Matches editOrder.ts's budget, for the same reason: a Neon cold start
      // inside the transaction must not look like a failed order. A fixed
      // handful of queries regardless of basket size (the stock re-check,
      // the single decrement, the order insert and its createMany, the key),
      // so this budget holds for a 300-line order as well as a 2-line one.
    }, { maxWait: 5_000, timeout: 8_000 });
    progress?.txEnd();
  } catch (err) {
    // Two requests with one key at the same moment: the other one won.
    if (idempotencyKey && err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const winner = await replayBuiltOrder(customer.id, idempotencyKey, { adminId, salesRepId });
      if (winner) return winner;
    }
    // A concurrent checkout took the last unit between the check above and
    // the decrement. Same shape as the pre-flight shortfall so the UI needs
    // one renderer, not two.
    if (err instanceof StockRaceError) {
      throw new CreateOrderError('Not enough stock for some items.', 400, {
        shortfalls: [{ productName: err.productName, needed: err.needed, available: err.available }],
      });
    }
    throw err;
  }

  return {
    order,
    deliveryFeeResolved: resolved.fee.toString(),
    deliveryFeeApplied: totals.delivery_fee.toString(),
  };
}

/**
 * Rewrite a DRAFT order's lines — and, when given, its address and planned
 * day — in place, priced afresh for its buyer.
 *
 * For a Home Grocery delivery kept in step with its plan: the household edits
 * its list, or prices move between the day the draft was made and the day
 * staff confirm it. In place, so the delivery keeps its order number and the
 * history shows one order per delivery rather than one per edit.
 *
 * ONLY A DRAFT. It holds no stock, so replacing its lines gives nothing back
 * and takes nothing. The row is locked for the rewrite and resolveDraftOrder
 * takes the same lock, so a confirm can never decrement one list while this
 * writes another. Returns null when the order is no longer a draft — someone
 * confirmed it in the meantime — and the caller leaves it alone.
 *
 * The delivery fee stays what it was unless the address changes: staff may
 * have set it by hand, and a new list is no reason to undo that. Lines whose
 * product no longer exists are left out; the caller decides what to say.
 */
export async function rewriteDraftOrder(
  orderId: string,
  change: {
    items: Array<{ variant_id: string; quantity: number }>;
    address_id?: string;
    scheduled_for?: Date;
  },
): Promise<Prisma.OrderGetPayload<{ include: { items: true } }> | null> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, status: 'draft', deleted_at: null },
    include: { user: { select: { id: true, is_business: true, pricing_mode: true } } },
  });
  if (!order) return null;

  const addressId = change.address_id ?? order.address_id;
  const address = await prisma.address.findUnique({ where: { id: addressId } });
  if (!address || address.user_id !== order.user_id) {
    throw new CreateOrderError('That address does not belong to this customer.', 422);
  }

  const byId = new Map(
    (await loadVariantsForPricing([...new Set(change.items.map((i) => i.variant_id))])).map((v) => [v.id, v]),
  );
  const lines = priceLines(
    change.items.filter((i) => byId.has(i.variant_id)),
    byId,
    pricingForAccount(order.user),
    await savedDiscountsFor(order.user_id, [...byId.keys()]),
  );

  let fee = order.delivery_fee;
  if (address.id !== order.address_id) {
    const resolved = resolveDeliveryFee({
      subtotal: lines.reduce((s, l) => s.plus(l.line_total), new Prisma.Decimal(0)),
      pricing: await getDeliveryPricing(),
      destination: address.latitude != null && address.longitude != null
        ? { lat: address.latitude, lng: address.longitude }
        : null,
      buyerIsBusiness: order.user.is_business,
    });
    fee = resolved.fee;
  }
  // The order's own regime, copied when it was placed (2026-11-04).
  const totals = computeOrderTotals(lines, fee, { recargo: order.recargo_equivalencia && !order.parent_order_id });

  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM orders
       WHERE id = ${orderId}::uuid AND status = 'draft' AND deleted_at IS NULL
       FOR UPDATE`;
    if (locked.length === 0) return null;
    await tx.orderItem.deleteMany({ where: { order_id: orderId } });
    return tx.order.update({
      where: { id: orderId },
      data: {
        address_id: address.id,
        address_snapshot: addressSnapshot(address),
        subtotal: totals.subtotal,
        delivery_fee: totals.delivery_fee,
        recargo: totals.recargo,
        total: totals.total,
        ...(change.scheduled_for ? { scheduled_for: change.scheduled_for } : {}),
        items: { createMany: { data: lines } },
      },
      include: { items: true },
    });
  }, { maxWait: 5_000, timeout: 8_000 });
}
