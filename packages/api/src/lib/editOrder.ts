// ─── Edit order items ────────────────────────────────────────
// Shared by admin and partner "edit order" endpoints. Editing items is NOT
// a plain field update like status/rider/notes — it has to touch stock,
// re-derive pricing, rebuild the item snapshot on replace, recompute
// order totals, write an audit trail, and (for a sub-order) recompute its
// ParentOrder's aggregates. Kept here (rather than duplicated in both
// route files) so admin and partner can never drift on what an edit
// actually does — same rationale as draftOrders.ts's resolveDraftOrder().
//
// Admin-only cross-store behavior (2026-08): a partner's add/replace target
// is always pre-validated at the route layer to belong to their own store
// (partner/orders.ts), so foreignBuckets below is always empty for a
// partner-originated call. For admin, a replace/add target may belong to a
// DIFFERENT store than the order's own — rather than silently letting that
// item sit on an order its owning store can never see (Order.store_id is
// what every partner query is scoped by), it's routed to a brand-new
// sub-order for that store, reusing the exact ParentOrder/sub-Order split
// checkout already uses for a multi-store cart (orders.ts ~327-460). This
// is intentionally NOT gated behind mv-flags' orderSplit — it's a normal,
// always-on capability independent of that flag's rollout state.
//
// It applies to a CUSTOMER'S purchase only (2026-10-15). An order staff or a
// rep built is Cesto's whatever it holds, so an edit keeps every line on it,
// exactly as building it did — see `builtByUs` below.

import { randomUUID } from 'crypto';
import type { ProgressTracker } from './orderProgress';
import { Prisma, OrderStatus, OrderEditAction, OrderEditActor } from '@prisma/client';
import prisma from './prisma';
import { lineTotal, lineDiscountFromUnit, unitDiscountOf, recargoFor } from './orderTotals';
import { restatePurchaseTotals } from './purchaseTotals';
import { rememberDiscounts, savedDiscountsFor, statedUnitDiscount, type DiscountDecision } from './customerDiscounts';
import { audienceOf, isShownTo } from './audience';
import {
  effectiveUnitPrice, lineVatSnapshot, pricingForAccount, pricingForViewer, VAT_FIELDS, type PricingContext,
} from './pricing';
import { generateOrderNumber } from './pagination';
import { generateParentOrderNumber } from './parentOrder';
import { issuedFacturaFor } from './invoicing';

export const EDITABLE_STATUSES: OrderStatus[] = ['pending', 'confirmed', 'preparing'];

/**
 * A draft our team built — staff, a rep, or a Home Grocery order — which
 * staff and the rep who built it may still change (2026-11-04).
 *
 * A draft holds no stock — POST /:id/confirm-stock is what takes it — so an
 * edit to one moves no stock and tells the customer nothing: they have not
 * been told about the order yet. Not a draft a customer's own checkout parked
 * (no creator, no Home Grocery): that is part of their purchase, split by
 * shop, and its rules have not been decided.
 *
 * Who may edit is the route's business: admin edits any of these, a rep only
 * the ones they built (routes/sales/orders.ts ownOrder), partners and
 * customers none.
 *
 * Stated again in packages/shared orderEditing.ts, which the screens read;
 * the API cannot import the shared barrel.
 */
/**
 * A draft the customer made themselves (2026-11-04): their own checkout parked
 * what was short on stock, or — before 2026-10-22 — their Home Grocery plan
 * made it. Nobody on our team built it. They may change it until its stock is
 * confirmed; the customer route scopes it to their own orders.
 */
export function isCustomersOwnDraft(order: {
  status: OrderStatus;
  created_by_admin_id: string | null;
  created_by_sales_rep_id: string | null;
}): boolean {
  return order.status === 'draft' && !order.created_by_admin_id && !order.created_by_sales_rep_id;
}

export function isEditableDraft(order: {
  status: OrderStatus;
  created_by_admin_id: string | null;
  created_by_sales_rep_id: string | null;
  rashan_subscription_id: string | null;
}): boolean {
  return order.status === 'draft'
    && !!(order.created_by_admin_id || order.created_by_sales_rep_id || order.rashan_subscription_id);
}

// Matches orders.ts checkout's grouping sentinel for Order/Product.store_id
// null ("Cesto house store") so null compares equal to null, not "no store".
const CESTO_KEY = '__cesto__';

export interface EditOrderOperation {
  action: 'update_qty' | 'replace' | 'remove' | 'add' | 'set_discount';
  /** Required for update_qty/replace/remove. Absent for add — there's no
   *  existing item yet, the new OrderItem's id becomes the log row's
   *  order_item_id once created. */
  order_item_id?: string;
  new_quantity?: number;
  new_variant_id?: string;
  /**
   * Flat euros off the line, for `set_discount` from a client that predates
   * per-unit discounts. 0 clears it. Ignored when `unit_discount` is sent.
   */
  discount_amount?: number;
  /**
   * Euros off ONE unit (2026-10-25), for `set_discount` and `add`. 0 clears
   * it. When staff or a rep send it, it is also remembered for this customer
   * and product size (lib/customerDiscounts). An `add` without it gets the
   * customer's saved discount, if any.
   */
  unit_discount?: number;
}

export interface EditOrderEditor {
  type: 'admin' | 'partner' | 'customer' | 'sales_rep';
  adminId?: string;
  partnerUserId?: string;
  /** The owning customer, for a self-service edit. Always equal to the
   *  order's own user_id — the customer route scopes by it — but recorded
   *  explicitly so a log row names its actor without re-reading the order. */
  customerId?: string;
  /** The rep, for an edit to an order they built. A users row, like the
   *  customer above — but a different fact, so a different column. */
  salesRepId?: string;
}

export interface EditOrderShortfall {
  productName: string;
  needed: number;
  available: number;
}

/** A brand-new sub-order created because an admin added/replaced with a
 *  product from a different store than the order being edited. */
export interface EditOrderNewOrder {
  id: string;
  order_number: string;
  store_id: string | null;
  store_name: string | null;
  total: number;
}

type OrderWithItems = Prisma.OrderGetPayload<{ include: { items: true } }>;

export type EditOrderResult =
  | { status: 'not_found' }
  | { status: 'not_editable'; currentStatus: OrderStatus }
  | { status: 'invalid_operation'; message: string }
  | { status: 'insufficient_stock'; shortfalls: EditOrderShortfall[] }
  | { status: 'invoiced'; invoiceNumber: string }
  | { status: 'edited'; order: OrderWithItems; newOrders: EditOrderNewOrder[] }
  /**
   * A draft edited down to nothing is cancelled instead (2026-11-04): it holds
   * no stock, so there is nothing to give back, and an empty draft is not an
   * order anybody can confirm. Its lines are kept as they were, so the
   * cancelled order still says what it held. `newOrders` is always empty — a
   * draft that empties brings nothing in.
   */
  | { status: 'draft_cancelled'; order: OrderWithItems; newOrders: EditOrderNewOrder[] };

/** What a draft cancelled by being emptied says, to its customer and the office. */
export const EMPTIED_DRAFT_REASON = 'Se quitaron todos los artículos del borrador';

// A 'slot_full' variant and its SlotFullSignal used to live here. A
// cross-store split reused the original order's booked delivery window and
// had to re-check that window's capacity. Booked windows went with the zone
// system — every order is ASAP and routed by ops — so there is no capacity
// left to exhaust and no way for a split to fail on one.

/**
 * Applies a batch of item-level edits (quantity change / replace / remove /
 * add) to an order in one transaction. `scopeWhere` lets a caller restrict
 * which orders it's allowed to touch (partner passes `ownOrderWhere(storeId)`;
 * admin passes none). Hard-blocks the whole batch on any stock shortfall —
 * no partial apply.
 */
/**
 * What a line costs after its discount.
 *
 * Every write of `line_total` goes through here, because the discount has to
 * survive a quantity change and a variant swap — a rep who knocks 2 EUR off a
 * case and then orders three of them still meant 2 EUR off, not six.
 *
 * Clamped at zero. A discount larger than the line can happen honestly: take
 * 5 EUR off a 12 EUR line, then drop the quantity to one. Refusing the
 * quantity change would be the wrong answer, and a negative line would flow
 * straight into the subtotal and the invoice VAT.
 */
function lineTotalFor(
  unitPrice: Prisma.Decimal,
  quantity: number,
  discount: Prisma.Decimal | null,
): Prisma.Decimal {
  // Delegated since discounts became settable at CREATION: the same line, on
  // the way in and after an edit, has to cost the same thing. The clamp and
  // the reasoning behind it moved to orderTotals.lineTotal with it.
  return lineTotal({ unit_price: unitPrice, quantity, discount_amount: discount });
}

export async function editOrder(
  orderId: string,
  operations: EditOrderOperation[],
  editor: EditOrderEditor,
  scopeWhere: Prisma.OrderWhereInput = {},
  note?: string,
  /** Where the edit has got to, for the page waiting on it — see orderProgress.ts. */
  progress?: ProgressTracker,
): Promise<EditOrderResult> {
  progress?.detail({ lines: operations.length });
  const result = await prisma.$transaction(async (tx): Promise<EditOrderResult> => {
    progress?.txStart();
    const readOrder = () => tx.order.findFirst({
      where: { id: orderId, deleted_at: null, ...scopeWhere },
      include: { items: true },
    });
    let order = await readOrder();
    if (!order) return { status: 'not_found' };
    // A DRAFT IS LOCKED AND READ AGAIN. Confirming its stock reads the lines
    // and takes that much under the same lock (lib/draftOrders); without it,
    // a confirm could take the old quantities while this writes new ones.
    // Read again after the wait, because the confirm may have placed it.
    if (order.status === 'draft') {
      await tx.$queryRaw`SELECT id FROM orders WHERE id = ${order.id}::uuid FOR UPDATE`;
      order = await readOrder();
      if (!order) return { status: 'not_found' };
    }
    // A draft: staff and reps change one our team built; a customer, one they
    // made themselves. Partners none — they confirm a draft's stock.
    const editableDraft = ((editor.type === 'admin' || editor.type === 'sales_rep') && isEditableDraft(order))
      || (editor.type === 'customer' && isCustomersOwnDraft(order));
    if (!EDITABLE_STATUSES.includes(order.status) && !editableDraft) {
      return { status: 'not_editable', currentStatus: order.status };
    }
    /** Holds no stock, so nothing below moves any. */
    const isDraft = editableDraft;

    // An ISSUED invoice is immutable and states this order's totals. Letting
    // the items drift away from it leaves two documents disagreeing about
    // what the customer owes, with no way to correct the one already sent —
    // the correction is a credit note, not an edit.
    //
    // This guard lives here rather than in the routes because every caller
    // needs it and only one had it: PUT /admin/orders/:id/delivery-fee
    // checked, PUT /admin/orders/:id/items did not, so an admin could
    // silently desync an issued invoice by changing the line items instead
    // of the fee. Drafts are deliberately NOT blocked — a draft invoice
    // re-reads its order on load, so it follows the edit.
    // Only a factura locks, and it may belong to the whole purchase rather
    // than to this one part of it — see issuedFacturaFor().
    const issued = await issuedFacturaFor(tx, order);
    if (issued) {
      return { status: 'invoiced', invoiceNumber: issued.invoice_number ?? '' };
    }

    if (operations.length === 0) {
      return { status: 'invalid_operation', message: 'No changes were submitted.' };
    }

    // Pricing context resolved from the ORDER'S CUSTOMER — mirrors
    // resolvePricingContext(req) in pricing.ts, re-implemented here since
    // there's no Express `req` inside a partner/admin edit action. Never
    // trust anything client-sent for price. `name` is pulled alongside
    // for the admin route's notifyAdminNewOrder alert on any new sub-order.
    const customer = await tx.user.findUnique({
      where: { id: order.user_id },
      select: { name: true, is_business: true, pricing_mode: true },
    });
    //
    // WHO is editing decides which rule. The customer changing their own
    // order gets their own storefront view, the same one their checkout used.
    // Anyone editing on their behalf — staff, a rep, a partner — prices by the
    // account, so a line added to a wholesale client's order is wholesale
    // whatever their toggle says. Same rule as building one (createOrder).
    const pricingCtx: PricingContext = editor.type === 'customer'
      ? pricingForViewer(customer)
      : pricingForAccount(customer);

    const itemsById = new Map(order.items.map((i) => [i.id, i]));

    /**
     * ONE STOCK MOVE PER LINE. A discount may ride alongside it.
     *
     * Every branch of the stock pass below measures against `item.quantity` —
     * the row as it was BEFORE this request — so a second operation that also
     * moves stock computes from a stale base. `update_qty` 4→9 followed by
     * `remove` took five units for the bump and gave four back for the
     * removal, and the difference vanished with nothing failing.
     *
     * Refused rather than fixed by tracking a running quantity, because the
     * stale base is the smaller half of the problem: "set this line to 9, then
     * replace it, then remove it" has no obviously right answer, and guessing
     * one silently is worse than saying no.
     *
     * `set_discount` IS ALLOWED ALONGSIDE ONE, and leaving it out of this test
     * is the whole point of counting moves rather than operations. It touches
     * no stock — the delta pass does not even have a branch for it — and
     * admin's edit modal deliberately sends it with a quantity change, because
     * changing how many and changing the price off are two separate facts
     * about one line. A guard that counted operations refused that, which is a
     * working screen told its own request was invalid.
     *
     * Two of the same kind on one line is still refused: that is a client bug
     * either way, and the second would silently win.
     */
    const MOVES_STOCK = new Set(['update_qty', 'remove', 'replace']);
    const movedLines = new Set<string>();
    const discountedLines = new Set<string>();
    for (const op of operations) {
      if (op.action === 'add' || !op.order_item_id) continue;
      const bucket = MOVES_STOCK.has(op.action) ? movedLines : discountedLines;
      if (bucket.has(op.order_item_id)) {
        return {
          status: 'invalid_operation',
          message: MOVES_STOCK.has(op.action)
            ? 'Each order line can only be added to, changed or removed once per edit. Combine the changes into one operation.'
            : 'A line can only have its discount set once per edit.',
        };
      }
      bucket.add(op.order_item_id);
    }

    for (const op of operations) {
      if (op.action === 'add') {
        if (!op.new_variant_id) {
          return { status: 'invalid_operation', message: 'add requires new_variant_id.' };
        }
        if (op.new_quantity == null || op.new_quantity < 1) {
          return { status: 'invalid_operation', message: 'add requires new_quantity of at least 1.' };
        }
        continue;
      }
      if (!op.order_item_id || !itemsById.has(op.order_item_id)) {
        return { status: 'invalid_operation', message: `Order item ${op.order_item_id} not found on this order.` };
      }
      if (op.action === 'update_qty' && (op.new_quantity == null || op.new_quantity < 1)) {
        return { status: 'invalid_operation', message: 'new_quantity must be at least 1 — use remove to delete an item.' };
      }
      if (op.action === 'set_discount' && op.unit_discount === undefined && op.discount_amount === undefined) {
        return { status: 'invalid_operation', message: 'set_discount requires unit_discount or discount_amount.' };
      }
      if (op.action === 'replace' && !op.new_variant_id) {
        return { status: 'invalid_operation', message: 'replace requires new_variant_id.' };
      }
    }

    // Pass 1: net stock delta per variant across ALL operations before
    // mutating anything, so a shortfall discovered on operation #3 aborts
    // before #1/#2 partially apply. Positive = give stock back to the
    // pool, negative = need more than is currently reserved. Spans every
    // variant regardless of which order it'll end up landing on — the
    // shortfall check below must stay atomic across the whole batch.
    const stockDelta = new Map<string, number>();
    const bump = (variantId: string, delta: number) =>
      stockDelta.set(variantId, (stockDelta.get(variantId) ?? 0) + delta);

    for (const op of operations) {
      if (op.action === 'add') {
        bump(op.new_variant_id!, -op.new_quantity!);
        continue;
      }
      const item = itemsById.get(op.order_item_id!)!;
      if (op.action === 'update_qty') {
        bump(item.variant_id, item.quantity - op.new_quantity!);
      } else if (op.action === 'remove') {
        bump(item.variant_id, item.quantity);
      } else if (op.action === 'replace') {
        bump(item.variant_id, item.quantity);
        bump(op.new_variant_id!, -(op.new_quantity ?? item.quantity));
      }
    }

    const variantIds = [...stockDelta.keys()];
    const variants = await tx.productVariant.findMany({
      where: { id: { in: variantIds } },
      // A line added or swapped in copies the size's buying price; asked for
      // by name, since lib/prisma omits it.
      omit: { cost_price: false },
      include: {
        product: {
          select: {
            id: true, name_es: true, name_en: true, brand: true, store_id: true, audience: true,
            // Its IVA, which a line added or swapped in is charged with.
            ...VAT_FIELDS,
            store: { select: { id: true, name: true } },
            images: { where: { is_primary: true }, take: 1, select: { url: true } },
          },
        },
      },
    });
    const variantById = new Map(variants.map((v) => [v.id, v]));
    /**
     * This customer's saved discounts for the products this edit brings in —
     * an `add` that states none, or a `replace`, gets theirs. Staff and rep
     * statements are collected in `remembered` and written once at the end.
     */
    const saved = await savedDiscountsFor(order.user_id, variantIds, tx);
    const remembered: DiscountDecision[] = [];
    const remembers = editor.type === 'admin' || editor.type === 'sales_rep';

    // A customer adding to their own order is offered only what they are
    // shown — B2C only, B2B only or both (lib/audience). Staff, reps and
    // partners are not held to it.
    if (editor.type === 'customer') {
      const kind = audienceOf(customer);
      for (const op of operations) {
        if (op.action !== 'add' && op.action !== 'replace') continue;
        const v = variantById.get(op.new_variant_id!);
        if (v && !isShownTo(v.product.audience, kind)) {
          return { status: 'invalid_operation', message: `"${v.product.name_es}" is not available for your account.` };
        }
      }
    }

    // Cross-store classification — which add/replace ops target a
    // different store than the order's own. Run before the zero-item
    // guard: its counting needs to know which ops actually keep/add an
    // item on THIS order vs. redirect to a new one.
    const originalStoreKey = order.store_id ?? CESTO_KEY;
    // An order our team built — staff in the panel, a rep — is Cesto's
    // whatever shops its products come from: we deliver what we sell
    // (lib/createOrder, rule 3). It is built as ONE order, so it stays one
    // when it is edited. Splitting a partner's product off here handed that
    // shop a part of an order it was never meant to fulfil, and put it on
    // their dashboard. Only a customer's own purchase splits by shop.
    // A Home Grocery order is Cesto's too, whoever placed it — the household
    // included (2026-10-23): one order, one delivery on its day.
    const builtByUs = !!(order.created_by_admin_id || order.created_by_sales_rep_id || order.rashan_subscription_id);
    const opTarget = new Map<number, { crossStore: boolean; storeId: string | null; storeName: string | null }>();
    operations.forEach((op, i) => {
      if (op.action !== 'add' && op.action !== 'replace') return;
      const v = variantById.get(op.new_variant_id!);
      if (!v) return; // missing/inactive — falls through to the shortfall check below
      const storeKey = v.product.store_id ?? CESTO_KEY;
      opTarget.set(i, {
        crossStore: !builtByUs && storeKey !== originalStoreKey,
        storeId: v.product.store_id,
        storeName: v.product.store?.name ?? null,
      });
    });

    // Reject an order left with zero items after applying every
    // remove/cross-store-replace op, accounting for adds that actually
    // land back on THIS order (a cross-store add/replace never does).
    const removedFromOriginalIds = new Set<string>();
    let addToOriginalCount = 0;
    operations.forEach((op, i) => {
      if (op.action === 'remove') removedFromOriginalIds.add(op.order_item_id!);
      else if (op.action === 'replace' && opTarget.get(i)?.crossStore) removedFromOriginalIds.add(op.order_item_id!);
      else if (op.action === 'add' && !opTarget.get(i)?.crossStore) addToOriginalCount += 1;
    });
    if (order.items.length - removedFromOriginalIds.size + addToOriginalCount <= 0) {
      // AN EMPTIED DRAFT IS CANCELLED. Nothing to restock — it took nothing —
      // and the lines stay as they were, so the record says what it held. The
      // routes do what each one's cancel does afterwards.
      if (isDraft) {
        const cancelled = await tx.order.update({
          where: { id: order.id },
          data: { status: 'cancelled', cancelled_reason: EMPTIED_DRAFT_REASON },
          include: { items: true },
        });
        return { status: 'draft_cancelled', order: cancelled, newOrders: [] };
      }
      return { status: 'invalid_operation', message: 'An order cannot be edited down to zero items — cancel it instead.' };
    }

    /**
     * What a DRAFT will ask for, per size. Nothing of it is set aside yet, so
     * a line it adds or raises must fit in stock as a whole, not only by the
     * change — the same check building the draft made. Lines the edit leaves
     * alone or lowers are not checked: confirming the stock checks every line.
     */
    const onDraft = new Map<string, number>();
    if (isDraft) {
      for (const i of order.items) onDraft.set(i.variant_id, (onDraft.get(i.variant_id) ?? 0) + i.quantity);
    }

    const shortfalls: EditOrderShortfall[] = [];
    for (const [variantId, delta] of stockDelta) {
      if (delta >= 0) continue; // giving stock back or unchanged — never a shortfall
      const v = variantById.get(variantId);
      // `delta` is what was on the order minus what will be, so the draft's
      // new total for this size is what it had minus the delta.
      const needed = isDraft ? (onDraft.get(variantId) ?? 0) - delta : -delta;
      if (!v || !v.is_active) {
        shortfalls.push({ productName: 'Unknown/inactive product', needed, available: 0 });
        continue;
      }
      if (v.stock_quantity < needed) {
        shortfalls.push({ productName: v.product.name_es, needed, available: v.stock_quantity });
      }
    }
    if (shortfalls.length > 0) return { status: 'insufficient_stock', shortfalls };
    progress?.step('saving');

    // ── Destination resolution — for every distinct foreign store
    // referenced by a cross-store op, retrofit a ParentOrder if this
    // order doesn't already have one, then create a brand-new sub-order
    // for that store (always new — no reuse of a prior edit's sibling,
    // simpler and more predictable per-edit audit trail).
    const foreignBuckets = new Map<string, { storeId: string | null; storeName: string | null }>();
    operations.forEach((op, i) => {
      const t = opTarget.get(i);
      if (t?.crossStore) foreignBuckets.set(t.storeId ?? CESTO_KEY, { storeId: t.storeId, storeName: t.storeName });
    });

    let parentOrderId = order.parent_order_id;
    let originalDeliveryFee = order.delivery_fee;
    const newOrders: EditOrderNewOrder[] = [];
    const destOrderIdByStoreKey = new Map<string, string>();

    if (foreignBuckets.size > 0) {
      if (!parentOrderId) {
        // Retrofit: this standalone order becomes the first sub-order of
        // a brand-new ParentOrder. Its own delivery_fee moves to the
        // parent — every sub-order carries delivery_fee: 0, same
        // convention checkout uses for a multi-store split — so its own
        // `total` drops by that amount once Pass 4 recomputes it below.
        // Expected side-effect of the split, not a bug.
        const newParent = await tx.parentOrder.create({
          data: {
            order_number: generateParentOrderNumber(),
            user_id: order.user_id,
            address_id: order.address_id,
            address_snapshot: order.address_snapshot as Prisma.InputJsonValue,
            payment_method: order.payment_method,
            subtotal: order.subtotal,
            delivery_fee_total: order.delivery_fee,
            total: order.total,
            customer_notes: order.customer_notes,
            // The same customer, the same regime: the purchase is charged the
            // recargo now (Pass 5), the order no longer (Pass 4).
            recargo_equivalencia: order.recargo_equivalencia,
          },
        });
        parentOrderId = newParent.id;
        originalDeliveryFee = new Prisma.Decimal(0);
        await tx.order.update({
          where: { id: order.id },
          data: { parent_order_id: parentOrderId, delivery_fee: originalDeliveryFee },
        });
      }

      // A slot-capacity check used to sit here: each new sub-order reused
      // the original's booked window and consumed one more unit of it, so
      // a split could fail with 'slot_full'. Booked windows are gone —
      // every order is ASAP — so a split can no longer be refused for
      // scheduling reasons, and the sub-orders below inherit no window.
      for (const [storeKey, bucket] of foreignBuckets) {
        const created = await tx.order.create({
          data: {
            order_number: generateOrderNumber(),
            user_id: order.user_id,
            address_id: order.address_id,
            address_snapshot: order.address_snapshot as Prisma.InputJsonValue,
            payment_method: order.payment_method,
            // Inherited, not re-read: a split is the same purchase, so both
            // halves must answer the same way about who bought it.
            buyer_is_business: order.buyer_is_business,
            /**
             * And about who BUILT it, for exactly the same reason.
             *
             * These were left null, so a sub-order spun off an edit answered
             * "the customer placed this themselves" — which put half of a
             * rep-built purchase in the customer book on the admin dashboard,
             * and made it invisible to the rep, whose list is scoped by this
             * column. They watched two items leave an order they built and
             * land somewhere they could not open.
             *
             * At most one is ever set; see lib/orderSource.
             */
            created_by_admin_id: order.created_by_admin_id,
            created_by_sales_rep_id: order.created_by_sales_rep_id,
            parent_order_id: parentOrderId!,
            store_id: bucket.storeId,
            subtotal: new Prisma.Decimal(0),
            delivery_fee: new Prisma.Decimal(0),
            total: new Prisma.Decimal(0),
            customer_notes: order.customer_notes,
            // Under the same regime as the purchase it joins; charged none of
            // its own (the purchase is).
            recargo_equivalencia: order.recargo_equivalencia,
          },
        });
        destOrderIdByStoreKey.set(storeKey, created.id);
        newOrders.push({
          id: created.id, order_number: created.order_number,
          store_id: bucket.storeId, store_name: bucket.storeName, total: 0,
        });
      }
    }

    // Pass 2: apply stock deltas in ONE statement, as create, confirm, cancel
    // and delete all do. Already netted per variant above, so this is a
    // round-trip per EDIT rather than per touched variant — the smallest of
    // the five, since the modal only submits changed lines, but there is no
    // reason for it to be the one that still scales with the work.
    //
    // The delta is signed: adding items takes stock (negative), removing them
    // gives it back (positive), and one `+ d.qty` serves both.
    //
    // NONE FOR A DRAFT. It took nothing, so there is nothing to give back,
    // and confirming its stock takes whatever it holds by then.
    const moves = isDraft ? [] : [...stockDelta.entries()]
      .filter(([, delta]) => delta !== 0)
      .sort((a, b) => (a[0] < b[0] ? -1 : 1));
    if (moves.length > 0) {
      await tx.$executeRaw`
        UPDATE product_variants AS v
           SET stock_quantity = v.stock_quantity + d.qty
          FROM (VALUES ${Prisma.join(
            moves.map(([id, delta]) => Prisma.sql`(${id}::uuid, ${delta}::int)`),
          )}) AS d(id, qty)
         WHERE v.id = d.id
      `;
    }

    // Pass 3: mutate OrderItem rows + build OrderEditLog rows.
    //
    // COLLECTED, THEN WRITTEN ONCE. This loop used to issue a statement per
    // operation — an `orderItem.update` for each changed line — which is free
    // on localhost and is a network round trip on Neon. Measured, the edit path
    // cost N + 11 statements against an 8-second transaction budget: a 120-line
    // edit is 131 round trips, and at 20ms each that is most of the budget
    // before the compute has even woken up. Create and cancel were already flat
    // (11 and 3); this is what made edit the odd one out.
    //
    // So the loop decides WHAT each row should become and the three statements
    // after it do the writing. The arithmetic is unchanged — every branch still
    // computes exactly what it computed before.
    const editLogRows: Prisma.OrderEditLogCreateManyInput[] = [];

    /** Final column values per item id. Seeded from the row, then overwritten. */
    type ItemPatch = {
      quantity: number;
      unit_price: Prisma.Decimal;
      line_total: Prisma.Decimal;
      discount_amount: Prisma.Decimal | null;
      unit_discount: Prisma.Decimal | null;
      product_id: string;
      variant_id: string;
      product_snapshot: Prisma.InputJsonValue;
      /** A new buying price, when a swap brings in another size; null = keep the line's. */
      unit_cost: Prisma.Decimal | null;
      /** The IVA a swapped-in size is charged with; null = keep the line's. */
      vat: ReturnType<typeof lineVatSnapshot> | null;
    };
    const patches = new Map<string, ItemPatch>();
    const removeIds: string[] = [];
    const newItems: Prisma.OrderItemCreateManyInput[] = [];

    /** The row as it stands, so a patch can change one column and keep the rest. */
    const patchFor = (item: (typeof order.items)[number]): ItemPatch => {
      const existing = patches.get(item.id);
      if (existing) return existing;
      const fresh: ItemPatch = {
        quantity: item.quantity,
        unit_price: item.unit_price,
        line_total: item.line_total,
        discount_amount: item.discount_amount,
        unit_discount: item.unit_discount,
        product_id: item.product_id,
        variant_id: item.variant_id,
        product_snapshot: item.product_snapshot as Prisma.InputJsonValue,
        unit_cost: null,
        vat: null,
      };
      patches.set(item.id, fresh);
      return fresh;
    };
    const editorFields =
      editor.type === 'admin'
        ? { editor_type: OrderEditActor.admin, editor_admin_id: editor.adminId }
        : editor.type === 'partner'
          ? { editor_type: OrderEditActor.partner, editor_partner_user_id: editor.partnerUserId }
          : editor.type === 'sales_rep'
            ? { editor_type: OrderEditActor.sales_rep, editor_sales_rep_id: editor.salesRepId }
            : { editor_type: OrderEditActor.customer, editor_customer_id: editor.customerId };

    for (let i = 0; i < operations.length; i++) {
      const op = operations[i];
      const target = opTarget.get(i);

      if (op.action === 'add') {
        const newVariant = variantById.get(op.new_variant_id!)!; // presence already validated above
        const qty = op.new_quantity!;
        const unitPrice = effectiveUnitPrice(newVariant, pricingCtx, newVariant.product);
        // The discount the line states, else the customer's saved one.
        const stated = statedUnitDiscount(op.unit_discount);
        const unitDiscount = stated !== undefined ? stated : (saved.get(newVariant.id) ?? null);
        const discount = lineDiscountFromUnit(unitDiscount, qty);
        const lineTotal = lineTotalFor(unitPrice, qty, discount);
        if (remembers && stated !== undefined) {
          remembered.push({ variantId: newVariant.id, productId: newVariant.product_id, amount: stated });
        }
        const newSnapshot = {
          name_es: newVariant.product.name_es,
          name_en: newVariant.product.name_en,
          brand: newVariant.product.brand,
          variant_name_es: newVariant.name_es,
          variant_name_en: newVariant.name_en,
          image_url: newVariant.product.images[0]?.url ?? null,
        };
        const destOrderId = target?.crossStore
          ? destOrderIdByStoreKey.get(target.storeId ?? CESTO_KEY)!
          : order.id;
        // The id is generated here rather than read back, so the row can go
        // out with every other new row in one createMany and still be named in
        // its own log line.
        const createdId = randomUUID();
        newItems.push({
          id: createdId,
          order_id: destOrderId,
          product_id: newVariant.product_id,
          variant_id: newVariant.id,
          quantity: qty,
          unit_price: unitPrice,
          discount_amount: discount,
          unit_discount: unitDiscount,
          line_total: lineTotal,
          unit_cost: newVariant.cost_price,
          ...lineVatSnapshot(newVariant.product),
          product_snapshot: newSnapshot as Prisma.InputJsonValue,
        });
        editLogRows.push({
          order_id: destOrderId, order_item_id: createdId, action: OrderEditAction.add,
          new_quantity: qty, new_product_id: newVariant.product_id, new_variant_id: newVariant.id,
          new_snapshot: newSnapshot as Prisma.InputJsonValue, new_line_total: lineTotal,
          note, ...editorFields,
        });
        continue;
      }

      const item = itemsById.get(op.order_item_id!)!;

      if (op.action === 'update_qty') {
        /**
         * The DISCOUNT comes off the patch, not the row.
         *
         * A quantity change and a discount change can arrive together for one
         * line — admin's modal sends exactly that. Reading `item` here and
         * `item.quantity` in the discount branch meant each ignored the
         * other's change, so whichever ran second wrote a line_total computed
         * from one stale input. The order totals are summed from these, so the
         * whole order was wrong by the difference.
         *
         * patchFor() is get-or-create per line, so both branches read and
         * write the same object and the last one to run leaves it correct —
         * whichever order they arrive in.
         */
        const patch = patchFor(item);
        /**
         * A discount is per unit (2026-10-25), so it follows the quantity: €2
         * off each of 3 is €6 off, of 5 is €10. A line discounted before then
         * has only a flat figure; it becomes that figure per unit here, the
         * first time its quantity changes — see unitDiscountOf.
         */
        const unitDiscount = unitDiscountOf(patch);
        if (unitDiscount) {
          patch.unit_discount = unitDiscount;
          patch.discount_amount = lineDiscountFromUnit(unitDiscount, op.new_quantity!);
        }
        const newLineTotal = lineTotalFor(patch.unit_price, op.new_quantity!, patch.discount_amount);
        patch.quantity = op.new_quantity!;
        patch.line_total = newLineTotal;
        editLogRows.push({
          order_id: order.id, order_item_id: item.id, action: OrderEditAction.update_qty,
          old_quantity: item.quantity, new_quantity: op.new_quantity!,
          old_line_total: item.line_total, new_line_total: newLineTotal,
          note, ...editorFields,
        });
      } else if (op.action === 'set_discount') {
        // Stored as null when cleared, so the edit log can still tell
        // "never discounted" from "discounted by nothing".
        // The QUANTITY comes off the patch — see the note in update_qty.
        const patch = patchFor(item);
        const stated = statedUnitDiscount(op.unit_discount);
        let next: Prisma.Decimal | null;
        if (stated !== undefined) {
          // Euros off one unit, as staff and reps enter it now.
          patch.unit_discount = stated;
          next = lineDiscountFromUnit(stated, patch.quantity);
          if (remembers) remembered.push({ variantId: patch.variant_id, productId: patch.product_id, amount: stated });
        } else {
          // A client from before per-unit discounts: its flat line figure.
          const raw = op.discount_amount ?? 0;
          next = raw > 0 ? new Prisma.Decimal(raw.toFixed(2)) : null;
          patch.unit_discount = null;
        }
        const newLineTotal = lineTotalFor(patch.unit_price, patch.quantity, next);
        patch.discount_amount = next;
        patch.line_total = newLineTotal;
        editLogRows.push({
          order_id: order.id, order_item_id: item.id, action: OrderEditAction.set_discount,
          // The quantity in effect, which a bump in the same edit has already
          // set. Logging the row's original would read as a change this
          // operation did not make.
          old_quantity: patch.quantity, new_quantity: patch.quantity,
          old_line_total: item.line_total, new_line_total: newLineTotal,
          note, ...editorFields,
        });
      } else if (op.action === 'remove') {
        removeIds.push(item.id);
        editLogRows.push({
          order_id: order.id, order_item_id: item.id, action: OrderEditAction.remove,
          old_quantity: item.quantity, old_line_total: item.line_total,
          old_product_id: item.product_id, old_variant_id: item.variant_id,
          old_snapshot: item.product_snapshot as Prisma.InputJsonValue,
          note, ...editorFields,
        });
      } else if (op.action === 'replace') {
        const newVariant = variantById.get(op.new_variant_id!)!; // presence already validated above
        const newQty = op.new_quantity ?? item.quantity;
        const unitPrice = effectiveUnitPrice(newVariant, pricingCtx, newVariant.product);
        // A discount belongs to a product size, so the new one brings the
        // customer's own for it — or none. (This used to keep the old line's
        // discount_amount on the row while leaving it out of line_total.)
        const replUnitDiscount = saved.get(newVariant.id) ?? null;
        const replDiscount = lineDiscountFromUnit(replUnitDiscount, newQty);
        const newLineTotal = lineTotalFor(unitPrice, newQty, replDiscount);
        const newSnapshot = {
          name_es: newVariant.product.name_es,
          name_en: newVariant.product.name_en,
          brand: newVariant.product.brand,
          variant_name_es: newVariant.name_es,
          variant_name_en: newVariant.name_en,
          image_url: newVariant.product.images[0]?.url ?? null,
        };

        if (target?.crossStore) {
          // Cross-store replace decomposes into: remove the old item from
          // THIS order (restocked already via Pass 1/2), and create the
          // new item on the destination order — same shape as a plain
          // remove + a plain add, just split across two Order rows.
          removeIds.push(item.id);
          editLogRows.push({
            order_id: order.id, order_item_id: item.id, action: OrderEditAction.remove,
            old_quantity: item.quantity, old_line_total: item.line_total,
            old_product_id: item.product_id, old_variant_id: item.variant_id,
            old_snapshot: item.product_snapshot as Prisma.InputJsonValue,
            note, ...editorFields,
          });

          const destOrderId = destOrderIdByStoreKey.get(target.storeId ?? CESTO_KEY)!;
          const movedId = randomUUID();
          newItems.push({
            id: movedId,
            order_id: destOrderId,
            product_id: newVariant.product_id, variant_id: newVariant.id,
            quantity: newQty, unit_price: unitPrice, line_total: newLineTotal,
            discount_amount: replDiscount, unit_discount: replUnitDiscount,
            unit_cost: newVariant.cost_price,
            ...lineVatSnapshot(newVariant.product),
            product_snapshot: newSnapshot as Prisma.InputJsonValue,
          });
          editLogRows.push({
            order_id: destOrderId, order_item_id: movedId, action: OrderEditAction.add,
            new_quantity: newQty, new_product_id: newVariant.product_id, new_variant_id: newVariant.id,
            new_snapshot: newSnapshot as Prisma.InputJsonValue, new_line_total: newLineTotal,
            note, ...editorFields,
          });
        } else {
          const patch = patchFor(item);
          patch.product_id = newVariant.product_id;
          patch.variant_id = newVariant.id;
          patch.quantity = newQty;
          patch.unit_price = unitPrice;
          patch.discount_amount = replDiscount;
          patch.unit_discount = replUnitDiscount;
          patch.line_total = newLineTotal;
          patch.product_snapshot = newSnapshot as Prisma.InputJsonValue;
          // Another size, so its buying price — not the old size's — and the
          // IVA its price was just charged with.
          patch.unit_cost = newVariant.cost_price;
          patch.vat = lineVatSnapshot(newVariant.product);
          editLogRows.push({
            order_id: order.id, order_item_id: item.id, action: OrderEditAction.replace,
            old_quantity: item.quantity, new_quantity: newQty,
            old_product_id: item.product_id, old_variant_id: item.variant_id,
            old_snapshot: item.product_snapshot as Prisma.InputJsonValue,
            new_product_id: newVariant.product_id, new_variant_id: newVariant.id,
            new_snapshot: newSnapshot as Prisma.InputJsonValue,
            old_line_total: item.line_total, new_line_total: newLineTotal,
            note, ...editorFields,
          });
        }
      }
    }
    /**
     * Three statements, whatever the size of the edit.
     *
     * A row that was patched and then removed must not be written back — the
     * per-row version applied operations in order, so the remove won. Dropping
     * them here preserves that without needing the two statements to be
     * ordered relative to each other.
     */
    for (const id of removeIds) patches.delete(id);

    if (patches.size > 0) {
      // Sorted by id so two concurrent edits touching overlapping baskets take
      // the row locks in the same order — the same reason the stock move above
      // sorts, and what stops two simultaneous edits deadlocking.
      const rows = [...patches.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
      await tx.$executeRaw`
        UPDATE order_items AS oi
           SET quantity         = d.quantity,
               unit_price       = d.unit_price,
               line_total       = d.line_total,
               discount_amount  = d.discount_amount,
               unit_discount    = d.unit_discount,
               product_id       = d.product_id,
               variant_id       = d.variant_id,
               product_snapshot = d.product_snapshot,
               -- Only a swap sets these; otherwise the line keeps its own.
               unit_cost        = COALESCE(d.unit_cost, oi.unit_cost),
               tax_rate_pct     = COALESCE(d.tax_rate_pct, oi.tax_rate_pct)
          FROM (VALUES ${Prisma.join(
            rows.map(([id, p]) => Prisma.sql`(
              ${id}::uuid,
              ${p.quantity}::int,
              ${p.unit_price.toString()}::numeric,
              ${p.line_total.toString()}::numeric,
              ${p.discount_amount === null ? null : p.discount_amount.toString()}::numeric,
              ${p.unit_discount === null ? null : p.unit_discount.toString()}::numeric,
              ${p.product_id}::uuid,
              ${p.variant_id}::uuid,
              ${JSON.stringify(p.product_snapshot)}::jsonb,
              ${p.unit_cost === null ? null : p.unit_cost.toString()}::numeric,
              ${p.vat === null ? null : p.vat.tax_rate_pct}::int
            )`),
          )}) AS d(id, quantity, unit_price, line_total, discount_amount, unit_discount, product_id, variant_id, product_snapshot, unit_cost, tax_rate_pct)
         WHERE oi.id = d.id
      `;
    }

    if (removeIds.length > 0) {
      await tx.orderItem.deleteMany({ where: { id: { in: removeIds } } });
    }

    if (newItems.length > 0) {
      await tx.orderItem.createMany({ data: newItems });
    }

    await tx.orderEditLog.createMany({ data: editLogRows });

    // What staff or a rep said about discounts, remembered for this customer
    // in the same transaction — an edit that rolls back changes nothing.
    if (remembered.length > 0) {
      await rememberDiscounts(tx, order.user_id, remembered, {
        orderId: order.id,
        adminId: editor.type === 'admin' ? editor.adminId : null,
        salesRepId: editor.type === 'sales_rep' ? editor.salesRepId : null,
      });
    }

    // Pass 4: recompute totals. THIS order's subtotal/total from its
    // (now-updated) items — never trust any client-sent total.
    // originalDeliveryFee accounts for the retrofit above (zeroed once
    // this order becomes a sub-order of a new parent).
    const freshItems = await tx.orderItem.findMany({ where: { order_id: order.id } });
    const newSubtotal = freshItems.reduce((s, i) => s.plus(i.line_total), new Prisma.Decimal(0));
    // RECARGO DE EQUIVALENCIA (2026-11-04) follows the lines: re-charged on
    // what the order holds now. A part of a purchase carries none — the
    // purchase is charged it on the whole, in Pass 5.
    const newRecargo = order.recargo_equivalencia && !parentOrderId
      ? recargoFor(freshItems, originalDeliveryFee)
      : new Prisma.Decimal(0);
    const newTotal = newSubtotal.plus(originalDeliveryFee).plus(newRecargo);

    const updatedOrder = await tx.order.update({
      where: { id: order.id },
      data: {
        subtotal: newSubtotal,
        recargo: newRecargo,
        total: newTotal,
      },
      include: { items: true },
    });

    // Each newly-created destination order: sum its own items (it only
    // ever received items in this same save, so this is its whole total).
    for (const no of newOrders) {
      const destItems = await tx.orderItem.findMany({ where: { order_id: no.id } });
      const destSubtotal = destItems.reduce((s, i) => s.plus(i.line_total), new Prisma.Decimal(0));
      const updatedDest = await tx.order.update({
        where: { id: no.id },
        data: {
          subtotal: destSubtotal,
          total: destSubtotal, // delivery_fee stays 0
        },
      });
      no.total = Number(updatedDest.total);
    }

    // Pass 5: ParentOrder aggregate recalculation — covers both a
    // pre-existing parent and one just retrofit above.
    //
    // THE PURCHASE'S DELIVERY FEE IS LEFT ALONE, which is the opposite of what
    // this did. It used to re-derive `delivery_fee_total` by summing the
    // parts' `delivery_fee`, and that was right while each part carried its
    // own share. The fee moved to the parent on 2026-10-10 — Cesto takes the
    // whole package out, so there is one delivery, charged once — and every
    // part has carried 0 since. Summing them wrote 0 over the figure the
    // office had set, on EVERY edit of ANY part: price the purchase, change a
    // line, and the fee was gone again.
    //
    // It took the fee off plain orders too, on the one edit that matters: the
    // retrofit above moves a standalone order's fee onto its new parent, and
    // this ran immediately afterwards and zeroed it.
    //
    // The parts' own fees still go into the TOTAL. Today they are all zero, so
    // this is exactly `subtotal + fee` — the same arithmetic the fee route
    // writes (applyDeliveryFee) — and rows priced before the fee moved still
    // add up instead of quietly losing theirs.
    //
    // Same rule as the delete path in routes/admin/orders.ts: dropping or
    // changing what is IN a purchase does not change what delivering it costs.
    if (parentOrderId) {
      // Subtotal, recargo and total from the live parts and the purchase's
      // own fee (lib/purchaseTotals) — the fee itself left as it is.
      await restatePurchaseTotals(tx, parentOrderId);
    }

    return { status: 'edited', order: updatedOrder, newOrders };
  }, {
    // ─── Budget, and why this needs one ────────────────────────────────────
    //
    // This ran on Prisma's defaults (maxWait 2s / timeout 5s) and admins were
    // getting a bare 500 on save. The work itself is small — the modal only
    // submits CHANGED lines, so a one-line edit is a handful of statements —
    // but the transaction is frequently the first thing to touch the database
    // on that request, and Neon suspends an idle compute. The wake-up lands
    // INSIDE the transaction and can eat the whole 5s before any real work
    // starts, which is why this failed intermittently and looked fine on a
    // retry: the second attempt hit a warm database.
    //
    // maxWait matters as much as timeout here. It is how long Prisma waits for
    // a connection before starting, and a cold pool can exceed 2s on its own.
    //
    // 8s stays under the client's 10s request timeout, which is the invariant
    // that keeps a failure honest: the server must lose the race, so it can
    // roll back and answer, rather than the client hanging up on a transaction
    // that goes on to commit. See the same reasoning on checkout in
    // routes/orders.ts. If this ever needs to be longer, raise the CLIENT
    // first and let it deploy.
    maxWait: 5_000,
    timeout: 8_000,
  });
  progress?.txEnd();
  return result;
}
