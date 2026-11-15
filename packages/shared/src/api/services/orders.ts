import { api } from '../client';
import type { Order, ParentOrder, PaymentMethod } from '../../types';

export interface OrderQuote {
  subtotal: string;
  deliveryFee: string;
  /**
   * Threshold that applied to THIS quote — under distance pricing that is
   * the matched band's own threshold, not a platform-wide number.
   *
   * Always null since 2026-09-25: free-delivery thresholds were removed. The
   * field stays on the wire so an installed app that still reads it sees the
   * value that makes it render nothing, rather than `undefined`.
   */
  freeDeliveryMin: null;
  /**
   * The fee is not set yet: our team adds it once it can see the order
   * (every customer order since 2026-10-23). `deliveryFee` is 0 and `total`
   * is the products. Absent from an older API.
   */
  deliveryFeePending?: boolean;
  /**
   * Recargo de equivalencia, when the customer is under the regime
   * (2026-11-04): included in `total`, shown on its own line. Absent otherwise.
   */
  recargo?: string;
  total: string;
  /**
   * The IVA inside `subtotal`, per rate (2026-11-01): checkout says "IVA
   * incluido" and shows these. Products only. Absent from an older API, when
   * checkout shows the note without figures.
   */
  tax?: QuoteTax;
  // `out_of_area` is deliberately gone: it was emitted when a cart item's
  // store did not cover the delivery postcode, and with the zone system
  // removed no item is ever excluded for where it is going.
  issues: { variantId: string; reason: 'unavailable' | 'out_of_stock' }[];
  /**
   * How the fee above was arrived at. Absent from an API deployed before
   * distance pricing, so treat it as optional and fall back to showing the
   * bare fee — the deploy window where the web app is ahead of the API is
   * real and must not blank out the delivery line.
   */
  delivery?: DeliveryBreakdown;
}

export interface QuoteTax {
  /** One row per rate the basket touches, lowest first; 2-decimal strings. */
  by_rate: Array<{
    rate_pct: number; base: string; vat: string; gross: string;
    /** The recargo de equivalencia for this rate, when the customer is under it. */
    recargo_pct?: number;
    recargo?: string;
  }>;
  base: string;
  vat: string;
}

export interface DeliveryBreakdown {
  mode: 'flat' | 'distance';
  /**
   * Why this mode. `banded` means it really was priced by distance;
   * `no_origin` / `no_bands` / `no_coords` mean distance pricing is switched
   * on but something was missing, so the flat fee was charged instead —
   * worth surfacing in admin, never to the customer.
   */
  /**
   * `b2b` means the buyer is a wholesale account and we do not charge them
   * delivery — `fee` is 0 while `baseFee` still carries what retail would
   * have paid. Added 2026-10-10; an older bundle that does not know the
   * value simply matches none of its branches and shows no explanation,
   * which is the right behaviour during a deploy.
   */
  /**
   * `set_later`: a customer's own order, which nobody prices at checkout —
   * our team sets the fee afterwards (2026-10-23).
   */
  reason: 'flat_mode' | 'no_origin' | 'no_bands' | 'no_coords' | 'banded' | 'b2b' | 'set_later';
  /** The fee before the free-delivery threshold was applied. */
  baseFee: string;
  freeFrom: string | null;
  /** Straight-line km from the platform origin. Null outside distance mode. */
  distanceKm: number | null;
  /** e.g. "Hasta 5 km", "5–20 km", "Más de 20 km". */
  bandLabel: string | null;
}

export interface CheckoutPayload {
  addressId: string;
  paymentMethod: PaymentMethod;
  customerNotes?: string;
  /**
   * A Home Grocery household's slot — the day and the part of the day. The
   * server makes every household checkout a Home Grocery order; without this
   * it uses the plan's default slot. Ignored for anyone else.
   */
  homeGrocery?: { scheduled_for: string; delivery_window?: 'morning' | 'afternoon' | 'evening' | null };
}

/** What a reorder put back in the cart, and what it could not. */
export interface ReorderResult {
  items: { productId: string; variantId: string; quantity: number }[];
  /** Variant ids left out — what older clients read. */
  skipped: string[];
  /** The same, by name and why. Absent from an older API. */
  skipped_items?: Array<{ variant_id: string; name_es: string; name_en: string; reason: 'unavailable' | 'out_of_stock' }>;
  /** Added, but fewer than the order had: stock ran short. */
  reduced?: Array<{ variant_id: string; name_es: string; name_en: string; wanted: number; added: number }>;
  /** Lines that went in. */
  added?: number;
}

// MV Slice 4: the list endpoint returns a mixed stream of solo Orders and
// ParentOrders. `__shape` disambiguates so the renderer doesn't have to
// sniff fields. Solo rows carry `store` (null = Cesto); parent rows carry
// `sub_orders` with per-store slim rows the frontend uses to render a
// "3 stores · N items" summary.
type StoreSlim = { id: string; slug: string; name: string; logo_url?: string | null } | null;

export interface OrderListItem {
  __shape?: 'order' | 'parent';
  id: string;
  order_number: string;
  status: Order['status'];
  total: string;
  payment_method: PaymentMethod;
  created_at: string;
  items?: { quantity: number; product_snapshot: Record<string, unknown> }[];
  _count: { items: number };
  // A Home Grocery order, and its slot: the day and the part of the day.
  rashan_subscription_id?: string | null;
  scheduled_for?: string | null;
  delivery_window?: 'morning' | 'afternoon' | 'evening' | null;
  /** Why it was cancelled — 'Skipped' for a plan delivery the household skipped. */
  cancelled_reason?: string | null;
  // Present on solo rows (post-Slice-4). Null for Cesto / pre-mv rows.
  store?: StoreSlim;
  // Present ONLY on parent rows. Each sub carries its own status pill data.
  sub_orders?: Array<{
    id: string;
    order_number: string;
    status: Order['status'];
    total: string;
    store: StoreSlim;
    items: { quantity: number; product_snapshot: Record<string, unknown> }[];
    _count: { items: number };
  }>;
  // Parent-only aggregates.
  subtotal?: string;
  delivery_fee_total?: string;
}

// MV Slice 4: checkout may return either a single Order or a split shape.
// The type union means callers must narrow before using — see CheckoutPage
// for the `'parent_order' in resp` navigation pattern.
export type CheckoutResponse =
  | Order
  | { parent_order: ParentOrder; orders: Order[] };

export interface PagedOrders {
  items: OrderListItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * What a customer may change on a placed order. `replace` exists in the
 * admin/partner API but not here: a customer swaps a size by removing the
 * line and adding the other one.
 */
export type CustomerOrderEditOperation =
  | { action: 'update_qty'; order_item_id: string; new_quantity: number }
  | { action: 'remove'; order_item_id: string }
  | { action: 'add'; new_variant_id: string; new_quantity: number };

/** Returned in the 409 body when an edit is refused for stock. */
export interface OrderEditShortfall {
  productName: string;
  needed: number;
  available: number;
}

export const ordersService = {
  /**
   * 30s, like the checkout and the cart sync around it. It used to take the
   * 10s default — the one step of the three that gave up soonest — and a
   * 600-line basket on a waking server does not price in 10s. Safe to wait
   * for: a quote writes nothing.
   */
  quote(addressId: string) {
    return api.post<OrderQuote>('/api/orders/quote', { addressId }, { timeoutMs: 30_000 });
  },
  /**
   * Place the order.
   *
   * The timeout is explicit, and it MUST stay above the server's transaction
   * budget in packages/api/src/routes/orders.ts (currently maxWait 5s /
   * timeout 15s). The client and the server are racing to decide the same
   * question, and the server has to win it:
   *
   *   - server first  → the transaction rolls back and answers 503. The
   *                     customer's screen and the database agree: no order.
   *   - client first  → the client aborts, but Node does not kill an Express
   *                     handler when the caller hangs up. The transaction runs
   *                     on and COMMITS. The customer is told it failed while
   *                     the order exists, and the retry places a second one.
   *
   * The default 10s was only barely above the server's old 5s, and a fix that
   * raised the server to 20s inverted the race in production. 30s restores a
   * wide margin and leaves room to raise the server budget later without
   * having to redeploy the frontends in lockstep to stay safe.
   */
  /**
   * Place the order.
   *
   * `idempotencyKey` is what makes a RETRY safe. A guard on the button stops
   * a second press; it does nothing about a request that was sent, succeeded,
   * and whose response never arrived — the customer presses again, or the app
   * retries, and without this a second real order is placed. With it the
   * server returns the first order instead.
   *
   * Optional, so a caller that does not pass one behaves exactly as before.
   */
  checkout(payload: CheckoutPayload, idempotencyKey?: string) {
    return api.post<CheckoutResponse>('/api/orders', payload, {
      timeoutMs: 30_000,
      ...(idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : {}),
    });
  },
  /**
   * `home_grocery: 'exclude'` leaves out Home Grocery orders; `active: 1` keeps only the orders
   * still on their way (an older API ignores either).
   */
  list(params: { status?: string; page?: number; limit?: number; home_grocery?: 'exclude'; active?: 1 } = {}) {
    return api.get<PagedOrders>('/api/orders', params);
  },
  get(id: string) {
    return api.get<Order>(`/api/orders/${id}`);
  },
  track(id: string) {
    return api.get<Pick<Order, 'id' | 'order_number' | 'status' | 'updated_at'> & {
      rider: { name: string; phone: string; vehicle_type: string } | null;
    }>(`/api/orders/${id}/track`);
  },
  /**
   * 30s, like placing the order, and for the same reason: it must outwait the
   * server's transaction budget (maxWait 5s + timeout 15s in
   * packages/api/src/routes/orders.ts), or the screen says "failed" for a
   * cancel that went through. A cancel restocks every line, so a big order's
   * cancel is not the quick status flip it looks like.
   */
  cancel(id: string, reason?: string, progressKey?: string) {
    return api.post<Order>(`/api/orders/${id}/cancel`, { reason }, {
      timeoutMs: 30_000,
      ...(progressKey ? { headers: { 'X-Progress-Key': progressKey } } : {}),
    });
  },
  /**
   * Change the items on an order that has not been dispatched yet.
   *
   * One batch, applied atomically — the server refuses the WHOLE set if any
   * line is short of stock, so a partial apply is not a state the caller has
   * to reason about. That is also why the UI collects changes locally and
   * sends them once, rather than firing a request per tap.
   */
  editItems(id: string, operations: CustomerOrderEditOperation[], progressKey?: string) {
    // 30s, like every other call that writes an order. It waited the 10s
    // default while the server may queue for a connection (5s) and then run
    // an 8s transaction — a big edit could be abandoned here and still land.
    return api.put<{ order: Order; draftCancelled?: boolean }>(`/api/orders/${id}/items`, { operations }, {
      timeoutMs: 30_000,
      ...(progressKey ? { headers: { 'X-Progress-Key': progressKey } } : {}),
    });
  },
  /** The customer's own note on an order that can still be changed. */
  setNotes(id: string, customerNotes: string) {
    return api.put<{ id: string; customer_notes: string | null }>(`/api/orders/${id}/notes`, { customer_notes: customerNotes });
  },
  /**
   * Put a past order back in the cart. 'replace' (the default) makes the cart
   * exactly the order; 'add' adds it to what is already there.
   */
  reorder(id: string, mode: 'add' | 'replace' = 'replace') {
    return api.post<ReorderResult>(`/api/orders/${id}/reorder`, { mode });
  },
};
