import { randomUUID } from 'crypto';
import { Router } from 'express';
import { MAX_ORDER_LINES, MAX_LINE_QUANTITY } from '../lib/orderLimits';
import { afterPlanOrderChange, homeGroceryFieldsFor, slotSchema, PlanError } from '../lib/homeGroceryPlan';
import { createOrderForCustomer, CreateOrderError } from '../lib/createOrder';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import {
  resolvePricingContext, effectiveUnitPrice, lineVatSnapshot, vatRateOf, VAT_FIELDS,
} from '../lib/pricing';
import { computeTaxBreakdown, centsToEuros, eurosToCents, recargoCents, recargoBasisPoints, type TaxLineInput } from '../lib/tax';
import { savedDiscountsFor } from '../lib/customerDiscounts';
import { audienceOf, audienceOfUser, isShownTo } from '../lib/audience';
import { lineTotal as pricedLineTotal, lineDiscountFromUnit, recargoFor } from '../lib/orderTotals';
import { success, error } from '../lib/response';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../lib/async';
import { getCart, clearCart, setCart, CartItem } from '../lib/cartStore';
import { generateOrderNumber, parsePage, paged } from '../lib/pagination';
import { deriveParentOrderStatus, generateParentOrderNumber, IN_PROGRESS_STATUSES } from '../lib/parentOrder';
import { mvFlags } from '../lib/mv-flags';
import {
  notifyAdminNewOrder,
  notifyAdminLowStock,
  notifyAdminDraftOrder,
  notifyOrderStatusChange,
  notifyAdminOrderEdited,
  notifyPartnerOrder,
  announceOrderBuiltForCustomer,
} from '../lib/notifications';
import { settleRepEarning } from '../lib/repEarnings';
import { editOrder, EDITABLE_STATUSES, isCustomersOwnDraft } from '../lib/editOrder';
import { trackProgress, readProgress } from '../lib/orderProgress';
import { sendOrderPlacedEmail, resolveEmailLang } from '../lib/mailer';

const router = Router();
router.use(requireAuth);

// ─── POST /api/orders/quote ─────────────────────────────
// Pre-checkout price preview — used by the checkout screen to render
// subtotal, delivery fee, and total before the user confirms.

const quoteSchema = z.object({
  addressId: z.string().uuid(),
});

router.post('/quote', validate(quoteSchema), asyncHandler(async (req, res) => {
  const userId = req.user!.userId;
  const cart = await getCart(userId);
  if (cart.length === 0) return error(res, 'Your cart is empty.', 400);

  // Existence and ownership only. There is no serviceability check: every
  // live store delivers everywhere, so any address the customer saved is a
  // valid destination.
  const address = await prisma.address.findFirst({
    where: { id: req.body.addressId, user_id: userId },
  });
  if (!address) return error(res, 'Address not found.', 404);

  // b2b_price comes along so business customers get quoted the price they
  // will actually be charged. resolvePricingContext reads the stored
  // pricing_mode — never a client-supplied flag.
  const pricingCtx = await resolvePricingContext(req);
  // The prices staff or a rep agreed with this customer — euros off one unit
  // of a product size (lib/customerDiscounts). The same rule checkout applies.
  const saved = await savedDiscountsFor(userId, cart.map((i) => i.variantId));

  const variants = await prisma.productVariant.findMany({
    where: { id: { in: cart.map((i) => i.variantId) } },
    select: {
      id: true, price: true, b2b_price: true, stock_quantity: true, is_active: true,
      product: { select: { store_id: true, name_es: true, name_en: true, audience: true, ...VAT_FIELDS } },
    },
  });

  let subtotal = new Prisma.Decimal(0);
  /** Each line as charged, with the IVA rate inside it — for `tax` below. */
  const taxLines: TaxLineInput[] = [];
  const issues: Array<{ variantId: string; reason: string }> = [];
  // A product not shown to this kind of customer (lib/audience) is
  // unavailable to them, as a product taken off sale is.
  const kind = audienceOf(pricingCtx);
  for (const item of cart) {
    const v = variants.find((x) => x.id === item.variantId);
    if (!v || !v.is_active || !isShownTo(v.product.audience, kind)) {
      issues.push({ variantId: item.variantId, reason: 'unavailable' });
      continue;
    }
    if (v.stock_quantity < item.quantity) {
      issues.push({ variantId: item.variantId, reason: 'out_of_stock' });
      continue;
    }
    // The out-of-area check that used to sit here is gone with the zone
    // system: every live store now delivers everywhere, so there is no
    // serviceability question to answer and no item can be excluded. Distance
    // only moves the delivery fee along a band ladder — it never refuses.
    const lineTotal = pricedLineTotal({
      unit_price: effectiveUnitPrice(v, pricingCtx, v.product),
      quantity: item.quantity,
      discount_amount: lineDiscountFromUnit(saved.get(v.id), item.quantity),
    });
    subtotal = subtotal.plus(lineTotal);
    taxLines.push({ grossCents: eurosToCents(lineTotal.toFixed(2)), rate_pct: vatRateOf(v.product) });
  }
  const tax = computeTaxBreakdown(taxLines);
  // RECARGO DE EQUIVALENCIA (2026-11-04) for a customer under the regime: on
  // each rate's base, as the order will be charged (lib/orderTotals) — on the
  // products here; the delivery fee's share follows when the office sets it.
  const underRecargo = (await prisma.user.findUnique({
    where: { id: userId }, select: { recargo_equivalencia: true },
  }))?.recargo_equivalencia ?? false;
  const recargoByRate = tax.groups.map((g) => (underRecargo ? recargoCents(g.base_cents, g.rate_pct) : 0));
  const recargoTotalCents = recargoByRate.reduce((a, b) => a + b, 0);

  // DELIVERY IS NOT PRICED HERE, for anyone (user decision 2026-10-23). The
  // office puts the fee on the order once it can see it, and the customer is
  // told (notifyDeliveryFeeSet). So the quote is the products, with a zero
  // that means "to come" — never "free", see deliveryFeeIsPending — and says
  // so in `deliveryFeePending`. Web and app builds from before this already
  // read a zero fee as "added later".
  const total = subtotal.plus(new Prisma.Decimal(centsToEuros(recargoTotalCents)));

  return success(res, {
    subtotal,
    deliveryFee: new Prisma.Decimal(0),
    deliveryFeePending: true,
    // Free-delivery thresholds were removed on 2026-09-25. The key stays and
    // is always null, because older web and mobile builds read it to decide
    // whether to draw the "spend €X more for free delivery" nudge — null is
    // the value that makes every one of them draw nothing. Drop the key and
    // an installed app reads undefined, which is the same outcome only if it
    // never does arithmetic on it first. Remove once those builds are gone.
    freeDeliveryMin: null,
    total,
    /**
     * The IVA inside `subtotal`, per rate (2026-11-01: checkout says "IVA
     * incluido" and shows it). Backed out of what each line is charged, as
     * the order's documents do it, so the figures agree with them. Products
     * only: delivery is set later and taxed on its own. Older clients ignore
     * the key.
     */
    tax: {
      by_rate: tax.groups.map((g, i) => ({
        rate_pct: g.rate_pct,
        base: centsToEuros(g.base_cents),
        vat: centsToEuros(g.vat_cents),
        gross: centsToEuros(g.gross_cents),
        ...(underRecargo ? { recargo_pct: recargoBasisPoints(g.rate_pct) / 100, recargo: centsToEuros(recargoByRate[i]) } : {}),
      })),
      base: centsToEuros(tax.taxable_base_cents),
      vat: centsToEuros(tax.vat_total_cents),
    },
    /**
     * Recargo de equivalencia, when this customer is under the regime
     * (2026-11-04): included in `total`, shown on its own line. Absent
     * otherwise, which older clients read as none.
     */
    ...(underRecargo ? { recargo: centsToEuros(recargoTotalCents) } : {}),
    issues,
    // How the delivery fee was arrived at. Lets checkout show
    // "12.4 km · Hasta 20 km" and explain the number instead of quoting a
    // bare figure. Clients that predate it ignore the key.
    delivery: {
      mode: 'flat',
      reason: 'set_later',
      baseFee: new Prisma.Decimal(0),
      freeFrom: null,
      distanceKm: null,
      bandLabel: null,
    },
  });
}));

// ─── POST /api/orders ───────────────────────────────────
// Checkout. Atomically validates stock, snapshots address + products,
// decrements stock, creates the order, and clears the cart.

/** One line's worth of stock to take, plus what a low-stock ping needs. */
interface StockDecrement {
  variantId: string;
  quantity: number;
  variant: {
    product_id: string;
    name_es: string;
    name_en: string;
    product: { name_es: string; name_en: string };
  };
}

interface DecrementedRow {
  stock_quantity: number;
  low_stock_threshold: number;
}

/**
 * Apply every stock decrement for a checkout in ONE round trip.
 *
 * This replaced a `tx.productVariant.update()` per cart line. Inside a
 * transaction those are sequential, so checkout time — and the transaction's
 * lock-holding time — scaled linearly with cart size. A large cart exceeded
 * the transaction budget on production and threw P2028, failing the order.
 *
 * The `locked` CTE is the part that matters for safety. Two customers checking
 * out overlapping carts take the same row locks, and if they take them in
 * different orders they deadlock. `ORDER BY id ... FOR UPDATE` makes every
 * checkout acquire them in the same order, so the second waits instead. The
 * CTE has to be referenced by the UPDATE or Postgres is free not to run it —
 * that is what the `IN (SELECT id FROM locked)` is for, not filtering.
 *
 * Quantities are aggregated per variant first: `UPDATE … FROM` applies a single
 * matching row when the source has duplicates, so two cart lines on one variant
 * would otherwise silently decrement once.
 */
export async function decrementStock(
  tx: Prisma.TransactionClient,
  decrements: StockDecrement[],
): Promise<Map<string, DecrementedRow>> {
  const out = new Map<string, DecrementedRow>();
  if (decrements.length === 0) return out;

  const totals = new Map<string, number>();
  for (const d of decrements) {
    totals.set(d.variantId, (totals.get(d.variantId) ?? 0) + d.quantity);
  }

  const ids = [...totals.keys()];
  const qtys = ids.map((id) => totals.get(id)!);

  const rows = await tx.$queryRaw<
    Array<{ id: string; stock_quantity: number; low_stock_threshold: number }>
  >`
    WITH locked AS (
      SELECT id FROM product_variants
      WHERE id = ANY(${ids}::uuid[])
      ORDER BY id
      FOR UPDATE
    )
    UPDATE product_variants pv
       SET stock_quantity = pv.stock_quantity - d.qty
      FROM unnest(${ids}::uuid[], ${qtys}::int[]) AS d(id, qty)
     WHERE pv.id = d.id
       AND pv.id IN (SELECT id FROM locked)
    RETURNING pv.id, pv.stock_quantity, pv.low_stock_threshold
  `;

  for (const r of rows) {
    out.set(r.id, {
      stock_quantity: r.stock_quantity,
      low_stock_threshold: r.low_stock_threshold,
    });
  }
  return out;
}

const checkoutSchema = z.object({
  addressId: z.string().uuid(),
  // `deliverySlotId` is deliberately absent. Booked delivery windows were
  // removed with the zone system — every order is ASAP and routed by ops.
  // Older mobile builds still send the field; zod strips unknown keys, so
  // those checkouts keep working instead of 400-ing on an extra property.
  // `bizum` is still accepted although nothing offers it any more. The app
  // on Play (versionCode 4) still shows it, and will until a release
  // reaches every phone — rejecting it here would break checkout for
  // whoever picks it. Drop the value once that build is gone.
  paymentMethod: z.enum(['cod', 'card', 'bizum']),
  customerNotes: z.string().max(500).optional(),
  /**
   * A Home Grocery household's slot: the day and part of the day. Optional:
   * a household's checkout without it gets the plan's default slot, and it is
   * ignored for anyone else. See homeGroceryCheckout below.
   */
  homeGrocery: slotSchema.optional(),
});

/**
 * The order a previous request with this key already placed, or null.
 *
 * Returns the SAME SHAPE the checkout returns, because the caller cannot tell
 * the difference and must not have to: a single Order for an ordinary basket,
 * `{ parent_order, orders }` for one that split across shops.
 *
 * Scoped to the account. The key comes from the client, so two customers can
 * generate the same one; looking it up by key alone would hand a stranger's
 * order back.
 */
async function replayCheckout(userId: string, key: string) {
  const prior = await prisma.orderIdempotency.findUnique({
    where: { user_id_key: { user_id: userId, key } },
  });
  if (!prior) return null;

  if (prior.parent_order_id) {
    const parent = await prisma.parentOrder.findUnique({ where: { id: prior.parent_order_id } });
    if (!parent) return null;
    const orders = await prisma.order.findMany({
      where: { parent_order_id: parent.id },
      include: { items: true },
    });
    return { parent_order: parent, orders };
  }

  if (prior.order_id) {
    // `null` rather than a throw when the order is gone: the only thing that
    // removes one is an account erasure, and inventing a 404 for a customer
    // who no longer exists helps nobody. Falling through places a fresh
    // order, which is the same answer they would have got without a key.
    return await prisma.order.findUnique({
      where: { id: prior.order_id },
      include: { items: true },
    });
  }
  return null;
}

router.post('/', validate(checkoutSchema), asyncHandler(async (req, res) => {
  const userId = req.user!.userId;
  const { addressId, paymentMethod, customerNotes } = req.body;

  /**
   * A REPLAY IS ANSWERED FIRST — before the cart is even read.
   *
   * That ordering is the whole point. The first request CLEARS the cart on
   * its way out, so a retry carrying the same key arrives at an empty one and
   * used to be told "Your cart is empty" — for an order that had in fact been
   * placed successfully a second earlier. Same wording the customer sees when
   * nothing worked at all, for the opposite situation.
   *
   * Optional, and absent means "behave exactly as before". An older web or
   * mobile bundle sends no header, which matters because frontends deploy
   * separately from this.
   */
  const idempotencyKey = (req.header('Idempotency-Key') ?? '').trim().slice(0, 255) || null;
  if (idempotencyKey) {
    const already = await replayCheckout(userId, idempotencyKey);
    // 200, not 201: nothing was created by THIS request, and a caller that
    // distinguishes them should see the truth.
    if (already) return success(res, already, 200);
  }

  const cart = await getCart(userId);
  if (cart.length === 0) return error(res, 'Your cart is empty.', 400);

  // The page placing a big order asks where it has got to — see orderProgress.ts.
  const progress = trackProgress(req, res, `user:${userId}`, 'checkout', {
    detail: { lines: cart.length }, txBudgetMs: 15_000,
  });

  // A Home Grocery household's cart is its grocery list, and whatever it
  // checks out is one of its Home Grocery orders — from any screen, an app
  // build with no slot screen included (2026-10-23).
  let hg: Awaited<ReturnType<typeof homeGroceryFieldsFor>>;
  try {
    hg = await homeGroceryFieldsFor(userId, req.body.homeGrocery, { lenient: true });
  } catch (err) {
    // A slot the household cannot have: in the past, too far ahead.
    if (err instanceof PlanError) return error(res, err.message, err.status);
    throw err;
  }
  if (hg) {
    return homeGroceryCheckout(req, res, {
      userId, cart, addressId, paymentMethod, customerNotes, idempotencyKey, progress, fields: hg.fields,
    });
  }

  // Resolved BEFORE the transaction and from the DB, so the price charged is
  // decided by the account's approved status — never by anything in the
  // request body. A business customer viewing b2b prices is charged them.
  const checkoutPricingCtx = await resolvePricingContext(req);
  // Their agreed prices: euros off one unit of a product size, set by staff
  // or a rep (lib/customerDiscounts). Recorded on the line as a discount, so
  // the product's own price on the order is unchanged.
  const savedDiscounts = await savedDiscountsFor(userId, cart.map((i) => i.variantId));

  // Tracked across the tx so we can emit admin pings *after* the commit
  // succeeds — never fire notifications for an order that rolled back.
  const lowStockHits: Array<{
    productId: string;
    productNameEs: string;
    productNameEn: string;
    variantNameEs: string;
    variantNameEn: string;
    remaining: number;
  }> = [];

  // MV Slice 4 dual-shape. Flag off → single Order (identical to pre-mv).
  // Flag on → orders always carry a store_id (null for Cesto per Product
  // convention), and a cross-store cart produces one ParentOrder + N subs.
  //
  // The transaction returns { parentOrder, orders[] } either way so the
  // post-tx notification + email logic can treat both shapes uniformly.
  // Single-store payload sets parentOrder=null and orders=[the one Order].
  // A split returns its sub-orders as `unreadOrderIds` instead, read back
  // after the commit — see (c) below.
  type PlacedOrder = Prisma.OrderGetPayload<{ include: { items: true } }>;
  type CheckoutOutcome = {
    parentOrder: Prisma.ParentOrderGetPayload<Record<string, never>> | null;
    orders: PlacedOrder[];
    unreadOrderIds?: string[];
  };
  const runCheckout = () => prisma.$transaction(async (tx): Promise<CheckoutOutcome> => {
    progress.txStart();
    /**
     * Single exit point for the transaction. Clears the cart INSIDE the tx
     * before returning, so a rolled-back order rolls the clear back with it
     * and a process death between commit and delete can't leave the customer
     * holding a paid order and a full cart.
     *
     * Every `return` below goes through this. The MV dual-shape gives this
     * transaction three exits (flag-off, single-store, multi-store split);
     * clearing at just one of them silently stopped emptying the cart for
     * the two common paths, which is exactly what happened before this
     * helper existed.
     */
    const finish = async <T extends { parentOrder: { id: string } | null; orders: { id: string }[] }>(
      result: T,
    ): Promise<T> => {
      await clearCart(userId, tx);
      /**
       * Written INSIDE the transaction, which is what makes the primary key
       * arbitrate a race rather than merely record one: two simultaneous
       * requests carrying the same key cannot both commit, and the loser is
       * sent to replayCheckout() to return the winner's order.
       */
      if (idempotencyKey) {
        await tx.orderIdempotency.create({
          data: {
            user_id: userId,
            key: idempotencyKey,
            order_id: result.parentOrder ? null : result.orders[0]?.id ?? null,
            parent_order_id: result.parentOrder?.id ?? null,
          },
        });
      }
      return result;
    };

    // Existence and ownership only — see the quote endpoint. Any saved
    // address is deliverable now that coverage is not modelled.
    const address = await tx.address.findFirst({
      where: { id: addressId, user_id: userId },
    });
    if (!address) throw new HttpError(404, 'Address not found.');

    // Slice 4: pull `product.store_id` alongside the existing snapshot fields.
    // Grouping happens per product, so store_id lives on Product (not Variant).
    const variants = await tx.productVariant.findMany({
      where: { id: { in: cart.map((i) => i.variantId) } },
      // The buying price, by name (lib/prisma omits it): each line copies it.
      omit: { cost_price: false },
      include: {
        product: {
          select: {
            id: true, name_es: true, name_en: true, brand: true, store_id: true, audience: true,
            // Its IVA, which every line is charged with (lib/pricing).
            ...VAT_FIELDS,
            images: { where: { is_primary: true }, select: { url: true }, take: 1 },
          },
        },
      },
    });

    // Build a per-cart-line payload plus its store_id key for grouping.
    // We build ALL payloads first (validating everything up front), then
    // group + persist — a single stock/availability failure aborts the
    // whole tx and we never end up with a partial ParentOrder.
    //
    // Draft orders (MV_DRAFT_ORDERS): when the flag is on, a line short on
    // stock no longer aborts the transaction — it's marked `isDraft` and
    // routed into its own sub-order below instead of the customer's normal
    // one. Stock is deliberately NOT decremented for a draft line; nothing
    // was reserved, so there's nothing to give back if it's later cancelled.
    type BuiltItem = {
      storeId: string | null;
      isDraft: boolean;
      payload: Prisma.OrderItemCreateManyOrderInput;
      lineTotal: Prisma.Decimal;
      productNameEs: string;
    };
    const built: BuiltItem[] = [];
    /** Stock to take, applied in one statement after the loop. */
    const decrements: StockDecrement[] = [];
    let subtotal = new Prisma.Decimal(0);

    for (const item of cart) {
      const v = variants.find((x) => x.id === item.variantId);
      if (!v || !v.is_active) throw new HttpError(400, 'One of your items is no longer available.');
      // Not shown to this kind of customer (lib/audience): not sold to them.
      if (!isShownTo(v.product.audience, audienceOf(checkoutPricingCtx))) {
        throw new HttpError(400, `"${v.product.name_es}" is not available for your account.`);
      }

      const shortOnStock = v.stock_quantity < item.quantity;
      if (shortOnStock && !mvFlags.draftOrders) {
        throw new HttpError(400, `Insufficient stock for "${v.product.name_es}".`);
      }
      const isDraft = shortOnStock;

      // The out-of-area hard stop that used to sit here is gone with the zone
      // system. A store no longer declares an area, so there is nothing an
      // address can fall outside of — every live store delivers everywhere and
      // distance is priced, not refused. Nothing else in this loop changes.

      // Business customers in b2b mode are charged wholesale; everyone else
      // pays retail. Falls back to retail per-variant when no b2b_price is
      // set, so a partially-priced catalogue still checks out correctly.
      const unitPrice = effectiveUnitPrice(v, checkoutPricingCtx, v.product);
      const unitDiscount = savedDiscounts.get(v.id) ?? null;
      const discount = lineDiscountFromUnit(unitDiscount, item.quantity);
      const lineTotal = pricedLineTotal({ unit_price: unitPrice, quantity: item.quantity, discount_amount: discount });
      subtotal = subtotal.plus(lineTotal);

      built.push({
        storeId: v.product.store_id,
        isDraft,
        lineTotal,
        productNameEs: v.product.name_es,
        payload: {
          product_id: v.product_id,
          variant_id: v.id,
          quantity: item.quantity,
          unit_price: unitPrice,
          discount_amount: discount,
          unit_discount: unitDiscount,
          line_total: lineTotal,
          unit_cost: v.cost_price,
          ...lineVatSnapshot(v.product),
          product_snapshot: {
            name_es: v.product.name_es,
            name_en: v.product.name_en,
            brand: v.product.brand,
            variant_name_es: v.name_es,
            variant_name_en: v.name_en,
            image_url: v.product.images[0]?.url ?? null,
          } as Prisma.InputJsonValue,
        },
      });

      if (isDraft) continue; // Nothing reserved — no decrement, no low-stock check.

      // Collected, not applied. Every decrement goes out in ONE statement after
      // the loop — see decrementStock() below for why.
      decrements.push({ variantId: v.id, quantity: item.quantity, variant: v });
    }

    // ─── Stock decrements, in a single round trip ───────
    //
    // This used to be `await tx.productVariant.update(...)` inside the loop
    // above: one sequential round trip per cart line, all inside the
    // transaction. That is what made checkout time scale with cart size and
    // eventually blow the transaction budget on large carts (P2028).
    //
    // Now it is one statement regardless of cart size.
    progress.step('reserving');
    const updatedRows = await decrementStock(tx, decrements);

    for (const d of decrements) {
      const row = updatedRows.get(d.variantId);
      // A missing row means the variant vanished between the read above and
      // this write. Treat it exactly like the pre-batch code would have — the
      // update would have thrown P2025 and rolled the transaction back.
      if (!row) throw new HttpError(400, 'One of your items is no longer available.');

      // Only flag when this decrement crossed the threshold — avoids
      // hammering admins with a low-stock ping on every subsequent order.
      const beforeQty = row.stock_quantity + d.quantity;
      if (
        row.stock_quantity <= row.low_stock_threshold &&
        beforeQty > row.low_stock_threshold
      ) {
        lowStockHits.push({
          productId: d.variant.product_id,
          productNameEs: d.variant.product.name_es,
          productNameEn: d.variant.product.name_en,
          variantNameEs: d.variant.name_es,
          variantNameEn: d.variant.name_en,
          remaining: row.stock_quantity,
        });
      }
    }

    // No delivery fee at checkout, for anyone (user decision 2026-10-23): the
    // office sets it on the order afterwards (PUT /api/admin/orders/:id/
    // delivery-fee, or the shop's or the rep's route) and the customer is
    // told. Until then it is zero, which every screen reads as "to come".
    const deliveryFee = new Prisma.Decimal(0);
    // RECARGO DE EQUIVALENCIA (2026-11-04), when the customer is under the
    // regime: charged once on the whole basket — on a single order, or on the
    // purchase when it splits by shop (its parts carry none), exactly as the
    // one factura computes it.
    const underRecargo = (await tx.user.findUnique({
      where: { id: userId }, select: { recargo_equivalencia: true },
    }))?.recargo_equivalencia ?? false;
    const recargo = underRecargo
      ? recargoFor(built.map((b) => ({ line_total: b.lineTotal, tax_rate_pct: b.payload.tax_rate_pct })), deliveryFee)
      : new Prisma.Decimal(0);
    const grandTotal = subtotal.plus(deliveryFee).plus(recargo);

    const addressSnapshot: Prisma.InputJsonValue = {
      contact_name: address.contact_name,
      contact_phone: address.contact_phone,
      street_line_1: address.street_line_1,
      street_line_2: address.street_line_2,
      postcode: address.postcode,
      city: address.city,
      province: address.province,
      delivery_notes: address.delivery_notes,
    };

    progress.step('creating');

    // ─── Persist ─────────────────────────────────────────
    // Path selection:
    //   (a) neither flag on           → single Order, store_id stays NULL (pre-mv shape)
    //   (b) flag(s) on, single group  → single Order, store_id + status set from that group
    //   (c) flag(s) on, multiple groups → ParentOrder + N sub-Orders
    //
    // "Group" now means (store, availability), not just store — draft
    // orders make a single store produce up to two groups (deliverable +
    // draft) even when MV_ORDER_SPLIT is off, since bucketing by
    // availability needs the same store-attributed shape multi-store
    // splitting already uses. That's why draftOrders also gates useStoreShape.
    const useStoreShape = mvFlags.orderSplit || mvFlags.draftOrders;

    if (!useStoreShape) {
      // (a) Legacy path — bit-identical to pre-Slice-4 behaviour. No drafts
      // are possible here: draftOrders is off whenever this branch runs, so
      // every built item is guaranteed non-draft (see the loop above).
      const created = await tx.order.create({
        data: {
          order_number: generateOrderNumber(),
          user_id: userId,
          address_id: address.id,
          address_snapshot: addressSnapshot,
          payment_method: paymentMethod,
          // What the buyer WAS at checkout. The admin order books split on
          // this, and reading it live off the user later would move the order
          // between books if their account type ever changed.
          buyer_is_business: checkoutPricingCtx.isBusiness,
          subtotal,
          delivery_fee: deliveryFee,
          recargo_equivalencia: underRecargo,
          recargo,
          total: grandTotal,
          customer_notes: customerNotes ?? null,
          items: { createMany: { data: built.map((b) => b.payload) } },
        },
        include: { items: true },
      });
      return finish({ parentOrder: null, orders: [created] });
    }

    // Group by (store_id, isDraft). CESTO_KEY sentinel for store_id=null
    // (Cesto house store), same convention as the pre-existing store-only
    // grouping — Maps allow null keys, but the string key keeps this
    // readable and lets us fold `isDraft` into the same key cleanly.
    const CESTO_KEY = '__cesto__';
    const groups = new Map<string, {
      storeId: string | null;
      isDraft: boolean;
      items: BuiltItem[];
      subtotal: Prisma.Decimal;
    }>();
    for (const b of built) {
      const key = `${b.storeId ?? CESTO_KEY}::${b.isDraft ? 'draft' : 'live'}`;
      const g = groups.get(key);
      if (g) {
        g.items.push(b);
        g.subtotal = g.subtotal.plus(b.lineTotal);
      } else {
        groups.set(key, { storeId: b.storeId, isDraft: b.isDraft, items: [b], subtotal: b.lineTotal });
      }
    }

    progress.detail({ shops: groups.size });

    if (groups.size === 1) {
      // (b) Single group — one Order with store_id set. No ParentOrder;
      // that shape would be redundant for a single fulfilment path. Status
      // is 'draft' when that lone group is the draft bucket (e.g. an
      // entirely out-of-stock single-store cart), otherwise the Prisma
      // default (`pending`) applies as before.
      const only = Array.from(groups.values())[0];
      const created = await tx.order.create({
        data: {
          order_number: generateOrderNumber(),
          user_id: userId,
          address_id: address.id,
          address_snapshot: addressSnapshot,
          payment_method: paymentMethod,
          buyer_is_business: checkoutPricingCtx.isBusiness,
          store_id: only.storeId,
          status: only.isDraft ? 'draft' : undefined,
          subtotal,
          delivery_fee: deliveryFee,
          recargo_equivalencia: underRecargo,
          recargo,
          total: grandTotal,
          customer_notes: customerNotes ?? null,
          items: { createMany: { data: only.items.map((b) => b.payload) } },
        },
        include: { items: true },
      });
      return finish({ parentOrder: null, orders: [created] });
    }

    // (c) Multiple groups — create ParentOrder first, then N sub-Orders.
    // Delivery fee attribution: full fee on the parent, 0 on every sub
    // (see [[multivendor-roadmap]] Slice 4). A draft sub carries
    // delivery_fee: 0 and its own subtotal as `total`, the exact same shape
    // every other sub already uses — the fee itself was already computed
    // from the deliverable-only subtotal above, so nothing extra is needed
    // here to keep a draft sub from being (over-)charged.
    const parent = await tx.parentOrder.create({
      data: {
        order_number: generateParentOrderNumber(),
        user_id: userId,
        address_id: address.id,
        address_snapshot: addressSnapshot,
        payment_method: paymentMethod,
        subtotal,
        delivery_fee_total: deliveryFee,
        recargo_equivalencia: underRecargo,
        recargo,
        total: grandTotal,
        customer_notes: customerNotes ?? null,
      },
    });

    /**
     * EVERY SUB-ORDER IN ONE STATEMENT, AND EVERY LINE IN ONE MORE.
     *
     * This was a loop of `tx.order.create({ items: { createMany }, include:
     * { items: true } })`, one per shop — four round trips each, all inside
     * what was then an 8s budget. On production the API (Render, Virginia) and the
     * database (Neon, Frankfurt) are an ocean apart, a tenth of a second or
     * more per round trip, so the loop cost ~0.55s per shop: a ten-shop
     * basket spent 5.5s of its 8s right here. On 2026-10-16 a 194-line,
     * ten-shop wholesale order failed with P2028 at the very last step
     * (clearCart) until a retry happened to land just under the budget.
     *
     * The ids are made here so each line can name its order without reading
     * the orders back. Reading them back WITH their lines happens after the
     * commit, where a round trip costs nothing against the budget. Now the
     * number of shops changes the size of two statements, not their count.
     */
    const subs = Array.from(groups.values()).map((g) => ({ id: randomUUID(), group: g }));
    await tx.order.createMany({
      data: subs.map(({ id, group: g }) => ({
        id,
        order_number: generateOrderNumber(),
        user_id: userId,
        address_id: address.id,
        address_snapshot: addressSnapshot,
        payment_method: paymentMethod,
        buyer_is_business: checkoutPricingCtx.isBusiness,
        parent_order_id: parent.id,
        store_id: g.storeId,
        status: g.isDraft ? 'draft' : undefined,
        subtotal: g.subtotal,
        delivery_fee: new Prisma.Decimal(0),
        // Under the purchase's regime; its recargo is the purchase's.
        recargo_equivalencia: underRecargo,
        total: g.subtotal,
        customer_notes: customerNotes ?? null,
      })),
    });
    await tx.orderItem.createMany({
      data: subs.flatMap(({ id, group: g }) => g.items.map((b) => ({ ...b.payload, order_id: id }))),
    });
    return finish({ parentOrder: parent, orders: [], unreadOrderIds: subs.map((sub) => sub.id) });
  }, {
    // ─── This budget MUST stay below the client's request timeout ───────────
    //
    // Node does NOT kill an Express handler when the client hangs up, so a
    // transaction still running after the client gave up goes on to COMMIT:
    // the customer is told the order failed while it exists, and a retry
    // without an attempt key places a second one. An earlier raise to 20s,
    // against clients that waited 10s, did exactly that in production. So:
    //
    //     everything this request does  <  the client's wait
    //
    // The client's wait is 30s — ordersService.checkout() has sent it since
    // 2026-09-10, so every web bundle and both app builds (v4 built 26 Sep,
    // v7 on 1 Oct) wait 30s. It covers the WHOLE request, not just this
    // transaction:
    //
    //     reads before it, geocoding included (3s cap)   ~ 1–4s
    //   + maxWait, the queue for a connection             ≤ 5s
    //   + timeout, the transaction itself                 ≤ 15s
    //   + the read-back and response after the commit     ~ 1–2s
    //                                                    ≈ 25s  <  30s
    //
    // The web sends an attempt key, so even a lost race returns the first
    // order on retry. The app does not yet, which is why the margin matters.
    //
    // Raised from 8s on 2026-10-16. A ten-shop order ran past 8s on
    // production that day (P2028 at clearCart): the API and the database are
    // an ocean apart, and sub-orders were written one shop at a time. The
    // writes are batched now and that order takes ~1–2s, so 15s is headroom
    // for a cold database (3.3s to wake was measured the same day) and a slow
    // instance — not a budget the normal path comes near.
    //
    // If this ever needs to go higher, raise the CLIENT first and let every
    // build that matters carry it. Past the client's wait, a visible failure
    // becomes a silent duplicate order, which is far worse.
    maxWait: 5_000,
    timeout: 15_000,
  });

  /**
   * TWO REQUESTS, ONE KEY, AT THE SAME MOMENT.
   *
   * Both get past the replay check above because neither has committed yet,
   * and both run the whole checkout. The primary key on order_idempotency
   * decides it: the second to commit violates it, its transaction rolls back
   * — order, stock moves, cart clear and all — and it answers with the order
   * the winner placed.
   *
   * The replay lookup is also the proof that the collision was OURS. A P2002
   * from anything else finds no row and is rethrown untouched.
   */
  let outcome: CheckoutOutcome;
  try {
    outcome = await runCheckout();
    progress.txEnd();
    progress.step('confirming');
  } catch (err) {
    if (idempotencyKey && err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const winner = await replayCheckout(userId, idempotencyKey);
      if (winner) return success(res, winner, 200);
    }
    throw err;
  }

  // A split's sub-orders were written without being read back (see (c)).
  // Read them now, committed, in the order they were made. Should this read
  // fail, the order still exists — and the attempt key hands it back on the
  // customer's retry instead of placing it again.
  if (outcome.unreadOrderIds) {
    const ids = outcome.unreadOrderIds;
    const rows = await prisma.order.findMany({ where: { id: { in: ids } }, include: { items: true } });
    const byId = new Map(rows.map((o) => [o.id, o]));
    outcome.orders = ids.map((id) => byId.get(id)).filter((o): o is PlacedOrder => Boolean(o));
  }

  // ─── Post-tx notifications + receipt email ───────────
  // Fire admin notifications after the tx commits. void → fire-and-forget;
  // the service catches its own errors so the response is never blocked.
  const customer = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true, preferred_language: true },
  });

  // One admin ping per Order. In split mode this is one ping per store —
  // each partner (and Cesto admin, who sees everything) gets their own
  // notification. Roadmap Slice 5+ may consolidate into a parent-summary
  // ping; today's one-per-sub matches the pre-mv single-Order behaviour.
  // A draft sub-order gets a distinct "needs stock" ping instead, so the
  // admin activity feed doesn't read it as a normal new order to fulfil.
  for (const o of outcome.orders) {
    // The shop whose part this is — a no-op for Cesto's own part.
    void notifyPartnerOrder({ orderId: o.id, kind: o.status === 'draft' ? 'draft' : 'new' });
    if (o.status === 'draft') {
      void notifyAdminDraftOrder({
        orderId: o.id,
        orderNumber: o.order_number,
        storeName: null,
        itemNames: o.items.map((i) => {
          const snap = i.product_snapshot as Prisma.JsonObject | null;
          return typeof snap?.name_es === 'string' ? snap.name_es : 'producto';
        }),
      });
    } else {
      void notifyAdminNewOrder({
        orderId: o.id,
        orderNumber: o.order_number,
        customerName: customer?.name ?? null,
        total: Number(o.total),
      });
    }
  }
  for (const hit of lowStockHits) void notifyAdminLowStock(hit);

  // Customer receipt email — best-effort; failure never blocks the response.
  // For split checkouts we send ONE email using the parent order's number +
  // totals — the customer paid once, they expect one receipt. Per-sub tracking
  // lands with the customer flip in Slice 5.
  if (customer?.email) {
    const receiptNumber = outcome.parentOrder?.order_number ?? outcome.orders[0].order_number;
    const receiptSubtotal = outcome.parentOrder ? Number(outcome.parentOrder.subtotal)     : Number(outcome.orders[0].subtotal);
    const receiptFee      = outcome.parentOrder ? Number(outcome.parentOrder.delivery_fee_total) : Number(outcome.orders[0].delivery_fee);
    const receiptTotal    = outcome.parentOrder ? Number(outcome.parentOrder.total)        : Number(outcome.orders[0].total);
    const itemCount = outcome.orders.reduce(
      (sum, o) => sum + o.items.reduce((s, i) => s + i.quantity, 0),
      0,
    );
    // Every sub carries the same address snapshot; pull from the first order.
    const snap = outcome.orders[0].address_snapshot as Prisma.JsonObject | null;
    const addressLines: string[] = [];
    if (snap) {
      if (typeof snap.street_line_1 === 'string') addressLines.push(snap.street_line_1);
      if (typeof snap.street_line_2 === 'string' && snap.street_line_2) {
        addressLines.push(snap.street_line_2);
      }
      const cityLine = [snap.postcode, snap.city].filter(Boolean).join(' ');
      if (cityLine) addressLines.push(cityLine);
      if (typeof snap.province === 'string' && snap.province) addressLines.push(snap.province);
    }
    const webBase = process.env.WEB_URL ?? 'http://localhost:5199';
    // Track URL points at the parent when split (Slice 5 renders the grouped
    // view there); otherwise at the sole Order as today.
    const trackId = outcome.parentOrder?.id ?? outcome.orders[0].id;
    void sendOrderPlacedEmail({
      to: customer.email,
      name: customer.name ?? '',
      lang: resolveEmailLang(customer.preferred_language),
      orderNumber: receiptNumber,
      itemCount,
      subtotal: receiptSubtotal,
      deliveryFee: receiptFee,
      // Not free delivery — delivery we have not priced yet (every customer
      // order since 2026-10-23). Saying "Free" in a receipt is the promise
      // this avoids.
      deliveryFeePending: receiptFee === 0,
      total: receiptTotal,
      addressLines,
      trackUrl: `${webBase.replace(/\/$/, '')}/orders/${trackId}`,
    }).catch((err) => console.error('[mail:order-placed] send failed', err));
  }

  // Response shape: single-store returns the sole Order (as today); split
  // returns { parent_order, orders } so a caller that knows the flag is on
  // gets the full picture. The customer web doesn't hit the split path
  // until Slice 5, so this new shape is API-only for now.
  if (outcome.parentOrder) {
    return success(res, { parent_order: outcome.parentOrder, orders: outcome.orders }, 201);
  }
  return success(res, outcome.orders[0], 201);
}));

/**
 * A Home Grocery household's checkout: its cart, as ONE Cesto order tagged
 * with its plan and slot — built by lib/createOrder like the orders staff and
 * reps place for it, never split by shop, and refused (with the shortfall
 * list) rather than parked as a draft when stock is short. The cart empties in
 * the same transaction. Answers in the shape of an ordinary single-order
 * checkout, so every client reads it as it reads any other.
 */
async function homeGroceryCheckout(
  req: Parameters<Parameters<typeof router.post>[1]>[0],
  res: Parameters<Parameters<typeof router.post>[1]>[1],
  o: {
    userId: string;
    cart: CartItem[];
    addressId: string;
    paymentMethod: 'cod' | 'card' | 'bizum';
    customerNotes?: string;
    idempotencyKey: string | null;
    progress: ReturnType<typeof trackProgress>;
    fields: NonNullable<Awaited<ReturnType<typeof homeGroceryFieldsFor>>>['fields'];
  },
) {
  let result;
  try {
    result = await createOrderForCustomer(
      {
        user_id: o.userId,
        address_id: o.addressId,
        payment_method: o.paymentMethod,
        items: o.cart.map((i) => ({ variant_id: i.variantId, quantity: i.quantity })),
        customer_notes: o.customerNotes,
        // Unpriced, like every customer's own order: the office sets it.
        delivery_fee: 0,
        ...o.fields,
      },
      { adminId: null, salesRepId: null },
      { idempotencyKey: o.idempotencyKey, progress: o.progress, inTransaction: (tx) => clearCart(o.userId, tx) },
    );
  } catch (err) {
    if (err instanceof CreateOrderError) return error(res, err.message, err.status, err.detail ?? null);
    throw err;
  }
  o.progress.step('confirming');
  if (!result.replayed) {
    void announceOrderBuiltForCustomer({ orderId: result.order.id, byCustomer: true });
    void afterPlanOrderChange(result.order.id);
  }
  return success(res, result.order, result.replayed ? 200 : 201);
}

// ─── GET /api/orders ────────────────────────────────────

// MV Slice 4 note: a split checkout produces one ParentOrder + N sub-Orders,
// and the customer's mental model is "one purchase = one row in my history"
// — the parent, not each sub. So this endpoint hides sub-orders (`parent_
// order_id IS NOT NULL`) and returns their ParentOrder in their place. Solo
// Orders (pre-mv rows + single-store post-Slice-4 checkouts) still surface
// as themselves, unchanged wire contract.
//
// Merging two tables (`orders` + `parent_orders`) into one paginated list
// can't be done in SQL cleanly. For MVP volumes (<100 orders per user) we
// over-fetch both, merge in JS by `created_at`, then slice — accepts a
// minor pagination imprecision for a much simpler implementation. Cursor-
// based pagination is the "right" answer if a user ever crosses ~500 rows.

router.get('/', asyncHandler(async (req, res) => {
  const params = parsePage(req.query, 10, 50);
  const status = req.query.status as string | undefined;
  const userId = req.user!.userId;

  // Solo-order filter — excludes sub-orders (they roll up to their parent).
  // deleted_at: null — an admin-hidden test/mistake order never shows up
  // in the customer's own order history either.
  const orderWhere: Prisma.OrderWhereInput = {
    user_id: userId,
    parent_order_id: null,
    deleted_at: null,
  };
  if (status) orderWhere.status = status as Prisma.OrderWhereInput['status'];
  // `active=1`: only the orders still on their way (2026-11-01) — the business home's live order
  // bar, which polls this. Without it the bar could only filter whatever fell in the newest page,
  // and an older order still in progress went missing. An older API ignores the param; the bar
  // filters the same statuses itself, so either deploy order is safe.
  const activeOnly = !status && (req.query.active === '1' || req.query.active === 'true');
  if (activeOnly) orderWhere.status = { in: [...IN_PROGRESS_STATUSES] };
  // A Home Grocery household's Mis pedidos is its Home Grocery history; this
  // lists what is left — its orders from before (2026-10-23). A split
  // purchase is never a Home Grocery one, so parents are unaffected.
  if (req.query.home_grocery === 'exclude') orderWhere.rashan_subscription_id = null;

  const parentWhere: Prisma.ParentOrderWhereInput = { user_id: userId };
  // Parent status is derived, not stored — filter is applied post-fetch
  // once we've computed `derived_status` per parent.

  // Fetch a generous chunk of each to survive merging; adequate for MVP
  // volumes where per-user order count rarely exceeds ~50.
  const CHUNK = params.skip + params.limit + 50;

  const [soloOrders, parentOrders, soloTotal, parentTotal] = await Promise.all([
    prisma.order.findMany({
      where: orderWhere,
      select: {
        id: true, order_number: true, status: true, total: true,
        payment_method: true, created_at: true,
        // A Home Grocery order reads with its day and part of the day — and a
        // skip reads "Skipped", which needs the reason a cancel was given.
        rashan_subscription_id: true, scheduled_for: true, delivery_window: true, cancelled_reason: true,
        store: { select: { id: true, slug: true, name: true, logo_url: true, status: true } },
        items: { select: { quantity: true, product_snapshot: true }, take: 3 },
        _count: { select: { items: true } },
      },
      orderBy: { created_at: 'desc' },
      take: CHUNK,
    }),
    prisma.parentOrder.findMany({
      where: parentWhere,
      select: {
        id: true, order_number: true, total: true, subtotal: true,
        delivery_fee_total: true, payment_method: true, created_at: true,
        sub_orders: {
          // Same deleted_at exclusion as the solo-order branch — a hidden
          // sub-order shouldn't render as part of the parent either.
          where: { deleted_at: null },
          select: {
            id: true, order_number: true, status: true, total: true,
            store: { select: { id: true, slug: true, name: true, logo_url: true, status: true } },
            items: { select: { quantity: true, product_snapshot: true }, take: 3 },
            _count: { select: { items: true } },
          },
          orderBy: { created_at: 'asc' },
        },
      },
      orderBy: { created_at: 'desc' },
      take: CHUNK,
    }),
    prisma.order.count({ where: orderWhere }),
    prisma.parentOrder.count({ where: parentWhere }),
  ]);

  // Tag each row with __shape so the frontend can pick a renderer without
  // having to sniff the fields. Keeps the wire contract explicit.
  const parentRows = parentOrders
    // A parent whose every sub was soft-deleted has nothing left to show —
    // drop it entirely rather than let deriveParentOrderStatus fall back to
    // its "empty list" default (meant for the checkout-always-creates-≥1-sub
    // invariant, not for "everything got hidden after the fact").
    .filter((p) => p.sub_orders.length > 0)
    .map((p) => ({
      __shape: 'parent' as const,
      ...p,
      status: deriveParentOrderStatus(p.sub_orders.map((s) => s.status)),
      _count: { items: p.sub_orders.reduce((sum, s) => sum + (s._count?.items ?? 0), 0) },
    }))
    // Apply the status filter here — parents use derived_status, which
    // Prisma can't filter on directly. Filtering client-side is correct
    // because the derived value is authoritative.
    .filter((p) => (status ? p.status === status : !activeOnly || (IN_PROGRESS_STATUSES as readonly string[]).includes(p.status)));

  const soloRows = soloOrders.map((o) => ({ __shape: 'order' as const, ...o }));

  const merged = [...parentRows, ...soloRows].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  // With `active`, count the parents that passed the filter, not every parent the user has.
  const total = soloTotal + (activeOnly ? parentRows.length : parentTotal);
  const pageSlice = merged.slice(params.skip, params.skip + params.limit);

  return success(res, paged(pageSlice, total, params));
}));

// ─── GET /api/orders/:id ────────────────────────────────
// MV Slice 4: :id may resolve to either an Order or a ParentOrder. We try
// Order first (the common case + pre-mv shape), fall back to ParentOrder.
// Response distinguishes itself by the presence of `sub_orders` (parent
// shape) vs the flat Order fields — Slice 5's customer UI picks the right
// renderer. Pre-mv rows return the exact same shape as before + null-valued
// `parent_order` / `store` fields that legacy clients ignore harmlessly.

// ─── GET /api/orders/progress/:key ──────────────────────
// Where the signed-in user's own big order operation has got to — checkout,
// a rep's create/edit/cancel, a customer's edit or cancel — polled by the
// page while the request is running. Declared before /:id, which would
// otherwise read "progress" as an order id. 404 for an unknown key or one
// belonging to someone else: the two are deliberately indistinguishable.
router.get('/progress/:key', (req, res) => {
  const view = readProgress(req.params.key, `user:${req.user!.userId}`);
  if (!view) return error(res, 'No progress for that key.', 404);
  return success(res, view);
});

router.get('/:id', asyncHandler(async (req, res) => {
  const userId = req.user!.userId;
  const order = await prisma.order.findFirst({
    where: { id: req.params.id, user_id: userId, deleted_at: null },
    include: {
      // Each line with its product's IVA band. A line made since 2026-11-01
      // carries the rate it was charged with (tax_rate_pct) and the order
      // editors preview that; an older line has none and is previewed at this,
      // as its albarán and factura are (lib/invoicing buildInvoiceLines).
      items: { include: { product: { select: VAT_FIELDS } } },
      rider: { select: { id: true, name: true, phone: true, vehicle_type: true } },
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
      // MV Slice 4 additions — both null for pre-mv rows.
      parent_order: true,
      store: { select: { id: true, slug: true, name: true, logo_url: true, status: true } },
    },
  });
  if (order) {
    // If this Order is a sub of a ParentOrder, surface the siblings so a
    // customer viewing one sub can see the whole picture without another
    // round-trip. Kept as a slim projection — full detail loads on click.
    if (order.parent_order_id) {
      const siblings = await prisma.order.findMany({
        where: { parent_order_id: order.parent_order_id, id: { not: order.id }, deleted_at: null },
        select: {
          id: true, order_number: true, status: true,
          subtotal: true, delivery_fee: true, total: true,
          rider: { select: { id: true, name: true } },
          store: { select: { id: true, slug: true, name: true, logo_url: true, status: true } },
          _count: { select: { items: true } },
        },
        orderBy: { created_at: 'asc' },
      });
      return success(res, { ...order, sibling_orders: siblings });
    }
    return success(res, order);
  }

  // Not an Order — try ParentOrder. Returned shape is a superset of Order:
  // same primitive fields where they overlap (order_number, subtotal, total)
  // plus `sub_orders: [...]` and a `derived_status` computed from the subs.
  const parent = await prisma.parentOrder.findFirst({
    where: { id: req.params.id, user_id: userId },
    include: {
      sub_orders: {
        where: { deleted_at: null },
        include: {
          // With the IVA band, as the single-order branch above.
          items: { include: { product: { select: VAT_FIELDS } } },
          rider: { select: { id: true, name: true, phone: true, vehicle_type: true } },
          store: { select: { id: true, slug: true, name: true, logo_url: true, status: true } },
        },
        orderBy: { created_at: 'asc' },
      },
    },
  });
  // No parent, or every sub was hidden — either way, nothing left to show.
  if (!parent || parent.sub_orders.length === 0) return error(res, 'Order not found.', 404);
  const derivedStatus = deriveParentOrderStatus(parent.sub_orders.map((s) => s.status));
  return success(res, { ...parent, derived_status: derivedStatus });
}));

// ─── GET /api/orders/:id/track ──────────────────────────
// Lightweight polling endpoint — only the fields the tracking screen needs.
// MV Slice 4: also handles a ParentOrder id, in which case we return the
// derived parent status + a slim per-sub status list so the client can
// render a whole-order tracker without a second call.

router.get('/:id/track', asyncHandler(async (req, res) => {
  const userId = req.user!.userId;
  const order = await prisma.order.findFirst({
    where: { id: req.params.id, user_id: userId, deleted_at: null },
    select: {
      id: true, order_number: true, status: true, updated_at: true,
      rider: { select: { name: true, phone: true, vehicle_type: true } },
    },
  });
  if (order) return success(res, order);

  const parent = await prisma.parentOrder.findFirst({
    where: { id: req.params.id, user_id: userId },
    select: {
      id: true, order_number: true, updated_at: true,
      sub_orders: {
        where: { deleted_at: null },
        select: {
          id: true, order_number: true, status: true,
          store: { select: { id: true, slug: true, name: true } },
          rider: { select: { name: true, phone: true, vehicle_type: true } },
        },
      },
    },
  });
  if (!parent || parent.sub_orders.length === 0) return error(res, 'Order not found.', 404);
  return success(res, {
    ...parent,
    status: deriveParentOrderStatus(parent.sub_orders.map((s) => s.status)),
  });
}));

// ─── POST /api/orders/:id/cancel ────────────────────────

const cancelSchema = z.object({ reason: z.string().max(500).optional() });

router.post('/:id/cancel', validate(cancelSchema), asyncHandler(async (req, res) => {
  const userId = req.user!.userId;
  const progress = trackProgress(req, res, `user:${userId}`, 'cancel', { txBudgetMs: 15_000 });

  const updated = await prisma.$transaction(async (tx) => {
    progress.txStart();
    const order = await tx.order.findFirst({
      where: { id: req.params.id, user_id: userId, deleted_at: null },
      include: {
        items: true,
      // ONLY A FACTURA LOCKS. A albaran is not a fiscal document — it is a
      // quote, and revising a quote is what a quote is for. Freezing an
      // order because someone printed one is backwards, and until the CIF
      // and the VAT review land, EVERY document is an albarán, so without
      // this every order would be frozen for a non-fiscal reason.
        invoices: { where: { status: 'issued', kind: 'invoice' }, select: { invoice_number: true } },
      },
    });
    if (!order) throw new HttpError(404, 'Order not found.');
    progress.detail({ lines: order.items.length });

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
    // Widened to `preparing` on 2026-09-30, alongside customer order
    // editing. The two have to agree: a customer who can strip an order
    // down to a single item while it is being packed cannot coherently be
    // refused a cancel at the same moment. The spec drew this line at
    // `confirmed` when cancelling was the only self-service action there
    // was. Past `preparing` it stays an ops decision — once a rider has it,
    // stopping it is a phone call, not a button.
    if (!['pending', 'confirmed', 'preparing', 'draft'].includes(order.status)) {
      throw new HttpError(400, 'This order can no longer be cancelled.');
    }

    // Restock — skipped for a draft order. Its items were never decremented
    // at checkout (there was no stock to reserve), so incrementing here
    // would wrongly inflate stock_quantity.
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
      data: { status: 'cancelled', cancelled_reason: req.body.reason ?? null },
    });
  }, {
    // Cancelling restocks, so this is proportional to the order rather than
    // the plain status flip it looks like. On Prisma's defaults a customer
    // with a large order sat on the wrong side of the window — and a cancel
    // that times out leaves them holding an order the screen has just told
    // them they can cancel. Same budget as placing the order.
    //
    // Raised from 8s with the checkout's, and safe for the same reason:
    // ordersService.cancel() waits 30s, and there is no read before this
    // transaction, so maxWait 5s + timeout 15s = 20s stays under it.
    //
    // Builds from before that change (app v4 and v7, an old web tab) still
    // wait 10s. For them a cancel that commits after 10s reads "failed" when
    // it worked — but a retry is harmless: the order is `cancelled` by then,
    // so the status check above refuses it and nothing is restocked twice.
    // And the whole transaction is a handful of round trips, about a second.
    maxWait: 5_000,
    timeout: 15_000,
  });
  progress.txEnd();
  progress.step('confirming');

  void notifyOrderStatusChange({
    userId,
    orderId: updated.id,
    orderNumber: updated.order_number,
    status: 'cancelled',
    reason: updated.cancelled_reason,
  });
  // Whoever was packing it has to stop.
  void notifyPartnerOrder({ orderId: updated.id, kind: 'cancelled', by: 'customer', reason: updated.cancelled_reason });
  // An order a rep built for them: noted on the rep's earnings as not earned.
  void settleRepEarning(updated.id);
  // A Home Grocery order cancelled moves the plan's next due day.
  void afterPlanOrderChange(updated.id);

  return success(res, updated);
}));

// ─── PUT /api/orders/:id/items ──────────────────────────
// A customer changes their own order while it is still in the shop's hands
// (pending / confirmed / preparing), or a draft they made themselves
// (2026-11-04; emptying one cancels it). Past that the rider has it and the
// contents are physically gone, so the window closes — same window
// EDITABLE_STATUSES gives admin and partner, and the same window cancel
// now uses.
//
// There is no payment to reconcile: nothing is captured online, so an edit
// just changes what is owed on delivery. That is the whole reason this can
// be self-service at all.
//
// Everything below delegates to editOrder(), which owns stock, re-pricing
// from the server, the audit trail and the totals. The route's job is the
// three refusals that are specific to a CUSTOMER doing the editing.

const customerEditSchema = z.object({
  // `replace` is deliberately absent, though editOrder supports it. Swapping
  // one variant for another is a staff action — a customer who wants a
  // different size removes the line and adds the other one, which produces
  // the same end state through operations they can actually see in the UI.
  operations: z.array(z.discriminatedUnion('action', [
    z.object({ action: z.literal('update_qty'), order_item_id: z.string().uuid(), new_quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY) }),
    z.object({ action: z.literal('remove'), order_item_id: z.string().uuid() }),
    z.object({ action: z.literal('add'), new_variant_id: z.string().uuid(), new_quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY) }),
  /**
   * The order's own ceiling, not a smaller one. A customer can now BUILD a
   * basket of up to MAX_ORDER_LINES, so capping their edit lower would let
   * them place an order they cannot then change — and the refusal would
   * arrive as a 422 about an array length. One operation per line is the most
   * editOrder() accepts anyway.
   */
  ])).min(1).max(MAX_ORDER_LINES),
});

router.put('/:id/items', validate(customerEditSchema), asyncHandler(async (req, res) => {
  const userId = req.user!.userId;
  const { operations } = req.body as z.infer<typeof customerEditSchema>;

  // Pre-read for the three customer-specific refusals. The status read here
  // is advisory only — editOrder re-checks it inside its own transaction,
  // so a status that changes in between is caught there, not raced here.
  const order = await prisma.order.findFirst({
    where: { id: req.params.id, user_id: userId, deleted_at: null },
    select: {
      id: true, status: true, store_id: true, order_number: true, parent_order_id: true,
      rashan_subscription_id: true, created_by_admin_id: true, created_by_sales_rep_id: true,
    },
  });
  // 404 rather than 403 for someone else's order: whether an id exists is
  // not something an unrelated account should be able to probe.
  if (!order) return error(res, 'Order not found.', 404);

  // A DRAFT THEY MADE THEMSELVES IS THEIRS TO CHANGE (2026-11-04) — what their
  // checkout parked when stock was short. It holds no stock, so the edit moves
  // none (lib/editOrder) and confirming it later takes what it then holds.
  // One our team built is the office's working copy until it is placed.
  if (order.status === 'draft' && !isCustomersOwnDraft(order)) {
    return error(
      res,
      'This order is waiting for us to confirm it and cannot be edited yet. Contact us if you need to change it.',
      422,
    );
  }

  if (!EDITABLE_STATUSES.includes(order.status) && order.status !== 'draft') {
    return error(
      res,
      `This order is ${order.status.replace(/_/g, ' ')} and can no longer be changed. Contact us if you need help with it.`,
      400,
    );
  }

  // Added items must belong to the SAME shop as the order. editOrder would
  // otherwise route them into a brand-new sub-order for the other shop —
  // correct behaviour for an admin building an order, alarming for a
  // customer who tapped "add" and got a second order with its own delivery.
  // Pre-validating here keeps foreignBuckets empty, exactly as
  // partner/orders.ts does for the same reason.
  const addedVariantIds = [...new Set(
    operations.flatMap((op) => (op.action === 'add' ? [op.new_variant_id] : [])),
  )];
  if (addedVariantIds.length > 0) {
    const variants = await prisma.productVariant.findMany({
      where: { id: { in: addedVariantIds } },
      select: {
        id: true, is_active: true,
        product: { select: { store_id: true, is_active: true, name_es: true } },
      },
    });

    if (variants.length !== addedVariantIds.length) {
      return error(res, 'One of the products you added is no longer available.', 400);
    }
    // editOrder checks the variant's own is_active but not its product's, so
    // a delisted product with a stale active variant would slip through.
    const unavailable = variants.filter((v) => !v.is_active || !v.product.is_active);
    if (unavailable.length > 0) {
      return error(
        res,
        `No longer available: ${unavailable.map((v) => v.product.name_es).join(', ')}.`,
        400,
      );
    }
    // A Home Grocery order is exempt: it is Cesto's and holds any shop's
    // products, as the grocery list it was placed from did, and editOrder
    // keeps every line it gains on it (builtByUs).
    const foreign = order.rashan_subscription_id
      ? []
      : variants.filter((v) => v.product.store_id !== order.store_id);
    if (foreign.length > 0) {
      return error(
        res,
        `${foreign.map((v) => v.product.name_es).join(', ')} ${foreign.length === 1 ? 'is' : 'are'} sold by a different shop and cannot be added to this order. Place a separate order for those.`,
        422,
      );
    }
  }

  const wasPreparing = order.status === 'preparing';

  const progress = trackProgress(req, res, `user:${userId}`, 'edit', { txBudgetMs: 8_000 });
  const result = await editOrder(
    req.params.id,
    operations,
    { type: 'customer', customerId: userId },
    // Scope: a customer can only ever reach their own order. Belt and
    // braces with the pre-read above — editOrder re-resolves the order
    // inside the transaction and this is what constrains that lookup.
    { user_id: userId },
    undefined,
    progress,
  );
  progress.step('confirming');

  if (result.status === 'not_found') return error(res, 'Order not found.', 404);
  if (result.status === 'not_editable') {
    return error(
      res,
      `This order is ${result.currentStatus.replace(/_/g, ' ')} and can no longer be changed.`,
      400,
    );
  }
  if (result.status === 'invoiced') {
    return error(
      res,
      'An invoice has already been issued for this order, so its contents are fixed. Contact us and we will sort it out.',
      409,
    );
  }
  if (result.status === 'invalid_operation') return error(res, result.message, 400);
  if (result.status === 'insufficient_stock') {
    return error(
      res,
      `Not enough stock: ${result.shortfalls.map((s) => `${s.productName} (you asked for ${s.needed}, ${s.available} left)`).join('; ')}`,
      409,
      { shortfalls: result.shortfalls },
    );
  }

  // EMPTIED, SO CANCELLED (lib/editOrder). What their own cancel does
  // afterwards, minus the notice to them — they just did it, on this screen.
  if (result.status === 'draft_cancelled') {
    void notifyPartnerOrder({ orderId: result.order.id, kind: 'cancelled', by: 'customer', reason: result.order.cancelled_reason });
    void settleRepEarning(result.order.id);
    void afterPlanOrderChange(result.order.id);
    return success(res, { order: result.order, draftCancelled: true });
  }

  // Tell ops and the shop, NOT the customer — they just made the change.
  // notifyOrderEdited points the other way and would email someone about
  // their own action.
  void notifyPartnerOrder({ orderId: result.order.id, kind: 'edited', by: 'customer' });
  void (async () => {
    try {
      const customer = await prisma.user.findUnique({
        where: { id: userId },
        select: { name: true },
      });
      await notifyAdminOrderEdited({
        orderId: result.order.id,
        orderNumber: result.order.order_number,
        customerName: customer?.name ?? null,
        newTotal: Number(result.order.total),
        wasPreparing,
      });
    } catch (err) {
      console.error('[notify] customer order edit alert failed', err);
    }
  })();

  return success(res, { order: result.order });
}));

// ─── PUT /api/orders/:id/notes ──────────────────────────
// The customer's own note on their order — "leave it with the neighbour" —
// changed while the order can still be changed at all (2026-10-30, the
// business panel's edit screen, which is the rep's: user, "edit order should
// be as we have edit order on rep side"). The same field checkout writes and
// the rep route (sales/orders) edits; the order's totals are not touched, so
// an issued invoice does not stand in its way. Nobody is notified, as with
// the rep's: whoever packs it reads the note on the order.
const customerNotesSchema = z.object({
  customer_notes: z.string().max(2000),
});

router.put('/:id/notes', validate(customerNotesSchema), asyncHandler(async (req, res) => {
  const userId = req.user!.userId;
  const { customer_notes: notes } = req.body as z.infer<typeof customerNotesSchema>;
  const order = await prisma.order.findFirst({
    where: { id: req.params.id, user_id: userId, deleted_at: null },
    select: { id: true, status: true, created_by_admin_id: true, created_by_sales_rep_id: true },
  });
  if (!order) return error(res, 'Order not found.', 404);
  // Their own draft too, which the same edit screen saves notes for.
  if (!EDITABLE_STATUSES.includes(order.status) && !isCustomersOwnDraft(order)) {
    return error(
      res,
      `This order is ${order.status.replace(/_/g, ' ')} and can no longer be changed. Contact us if you need help with it.`,
      400,
    );
  }
  const updated = await prisma.order.update({
    where: { id: order.id },
    data: { customer_notes: notes.trim() || null },
    select: { id: true, customer_notes: true },
  });
  return success(res, updated);
}));

// ─── POST /api/orders/:id/reorder ───────────────────────
//
// Puts a past order's products back in the cart — a Home Grocery household's
// grocery list — and says what could not go back, by name.
//
// `mode`: 'replace' (the default, and all an older client knows) makes the
// cart exactly the order; 'add' keeps what is already in the cart and adds
// the order on top, so "same as last time" never throws away what someone
// has just picked. The id may be a purchase that split across shops: its
// parts are reordered together.

// Defaulted as a whole: an older client posts no body at all.
const reorderSchema = z.object({ mode: z.enum(['add', 'replace']).default('replace') }).default({ mode: 'replace' });

router.post('/:id/reorder', validate(reorderSchema), asyncHandler(async (req, res) => {
  const userId = req.user!.userId;
  const { mode } = req.body as z.infer<typeof reorderSchema>;

  const orders = await prisma.order.findMany({
    where: { user_id: userId, deleted_at: null, OR: [{ id: req.params.id }, { parent_order_id: req.params.id }] },
    include: { items: true },
  });
  if (orders.length === 0) return error(res, 'Order not found.', 404);

  // What the order asked for, per variant — a variant can be on two lines.
  const wanted = new Map<string, { quantity: number; name_es: string; name_en: string }>();
  for (const item of orders.flatMap((o) => o.items)) {
    const snap = (item.product_snapshot ?? {}) as { name_es?: string; name_en?: string };
    const prior = wanted.get(item.variant_id);
    wanted.set(item.variant_id, {
      quantity: (prior?.quantity ?? 0) + item.quantity,
      name_es: prior?.name_es ?? snap.name_es ?? 'Producto',
      name_en: prior?.name_en ?? snap.name_en ?? snap.name_es ?? 'Product',
    });
  }

  const variants = await prisma.productVariant.findMany({
    where: { id: { in: [...wanted.keys()] } },
    select: { id: true, product_id: true, stock_quantity: true, is_active: true, product: { select: { is_active: true, audience: true } } },
  });
  const byId = new Map(variants.map((v) => [v.id, v]));
  const kind = await audienceOfUser(userId);

  const current = mode === 'add' ? await getCart(userId) : [];
  const next = new Map(current.map((c) => [c.variantId, { ...c }]));
  const skipped: string[] = [];
  const skippedItems: Array<{ variant_id: string; name_es: string; name_en: string; reason: 'unavailable' | 'out_of_stock' }> = [];
  const reduced: Array<{ variant_id: string; name_es: string; name_en: string; wanted: number; added: number }> = [];
  let added = 0;

  for (const [variantId, w] of wanted) {
    const v = byId.get(variantId);
    // Not shown to this kind of customer any more (lib/audience): unavailable.
    const hidden = !!v && !isShownTo(v.product.audience, kind);
    if (!v || !v.is_active || !v.product.is_active || hidden || v.stock_quantity <= 0) {
      skipped.push(variantId);
      skippedItems.push({ variant_id: variantId, name_es: w.name_es, name_en: w.name_en, reason: !v || !v.is_active || !v.product.is_active || hidden ? 'unavailable' : 'out_of_stock' });
      continue;
    }
    const already = next.get(variantId)?.quantity ?? 0;
    const target = Math.min(already + w.quantity, v.stock_quantity, MAX_LINE_QUANTITY);
    if (target - already < w.quantity) {
      reduced.push({ variant_id: variantId, name_es: w.name_es, name_en: w.name_en, wanted: w.quantity, added: Math.max(0, target - already) });
    }
    if (target > already) added += 1;
    next.set(variantId, { productId: v.product_id, variantId, quantity: Math.max(target, already) });
  }

  await setCart(userId, [...next.values()]);
  return success(res, { items: await getCart(userId), skipped, skipped_items: skippedItems, reduced, added });
}));

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

router.use((err: unknown, _req: any, res: any, next: any) => {
  if (err instanceof HttpError) return error(res, err.message, err.status);
  next(err);
});

export default router;
