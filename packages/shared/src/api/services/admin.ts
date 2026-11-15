import { api, getApiBaseUrl } from '../client';
import { getTokenStorage } from '../storage';
import type {
  Product, Category, SubCategory, PendingCategory, PendingProduct, Order, OrderStatus,
  // DeliveryZone / DeliverySlot dropped — the types no longer exist.
  Banner, Rider, User, CategoryApprovalStatus, EditOrderRequest, EditOrderResponse,
  AdminOrderGroup, Address, CustomerProductDiscount, ProductAudience, SalesRepStore,
  AdminRepEarnings, AdminRepOrderEarning, RepOrderEarningInput, RepEntryDetail, OrderBill,
} from '../../types';
import type { VatCategory } from '../../tax';

export type AdminRole = 'super_admin' | 'ops' | 'catalog' | 'lawyer';
export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: AdminRole;
  last_login_at: string | null;
  /**
   * Signed in with a password somebody else chose: the panel asks for a new one
   * before anything else, and the API refuses the rest until then. Absent from an
   * API older than 2026-11-07.
   */
  must_change_password?: boolean;
}

export interface AdminAuthTokens {
  accessToken: string;
  refreshToken: string;
  admin: AdminUser;
}

export interface Paged<T> { items: T[]; total: number; page: number; limit: number; totalPages: number }

export const adminAuth = {
  async login(email: string, password: string) {
    const res = await api.post<AdminAuthTokens>('/api/admin/auth/login', { email, password }, { skipAuth: true });
    await getTokenStorage().setTokens(res.accessToken, res.refreshToken);
    return res;
  },
  me() {
    return api.get<AdminUser>('/api/admin/auth/me');
  },
  /** Their own password. Every other session ends; this one carries on with the new tokens. */
  async changePassword(currentPassword: string, newPassword: string) {
    const res = await api.post<AdminAuthTokens>('/api/admin/auth/change-password', { currentPassword, newPassword });
    await getTokenStorage().setTokens(res.accessToken, res.refreshToken);
    return res;
  },
  async logout() {
    await getTokenStorage().clear();
  },
};

export type DashboardRange = 'today' | '7d' | '30d' | 'month' | 'year';

export interface DashboardStats {
  range?: DashboardRange;
  from?: string;
  to?: string;
  /** Current shape. */
  period?: { orders: number; revenue: number };
  /** Legacy shape — older API deploys still return this; read both. */
  today?: { orders: number; revenue: number };
  /** Legacy field — older API deploys included a 7-day series. */
  weekly?: Array<{ day: string; orders: number; revenue: number }>;
  pendingOrders: number;
  activeOrders: number;
  totalUsers: number;
  totalProducts: number;
  lowStockVariants: number;
  draftOrders?: number;
  /**
   * The same figures split by who placed the order — see AdminOrderSource.
   * Optional: an API deployed before this shipped does not send it, and the
   * dashboard simply shows the combined tiles it always did.
   */
  /**
   * One entry per tab on the orders page. A partition, so these sum to the
   * period totals above.
   */
  byBook?: Record<'customer' | 'rashan' | 'b2bOnline' | 'b2bRep', DashboardSourceStats>;
  /** Deprecated: the coarser split by who placed the order. */
  bySource?: Record<AdminOrderSource, DashboardSourceStats>
    & { rashan?: DashboardSourceStats };
}

export interface DashboardSourceStats {
  orders: number;
  revenue: number;
  pendingOrders: number;
  activeOrders: number;
  draftOrders: number;
}

export const adminDashboard = {
  stats(params: { range?: DashboardRange } = {}) {
    return api.get<DashboardStats>('/api/admin/dashboard/stats', params);
  },
  recentOrders() {
    return api.get<Array<Pick<Order, 'id' | 'order_number' | 'status' | 'total' | 'created_at'> & { user: { name: string } }>>(
      '/api/admin/dashboard/recent-orders',
    );
  },
};

export interface CreateAdminOrderPayload {
  user_id: string;
  address_id: string;
  /** Bizum is no longer offered. The DB enum keeps the value so historical
   *  orders still read, but nothing creates a new one. */
  payment_method?: 'cod' | 'card';
  /**
   * Flat euros off a line, set while building the order.
   *
   * Optional, so a caller that does not send it behaves exactly as before —
   * which matters while an older bundle talks to a newer API.
   */
  /** `unit_discount`: euros off one unit, remembered for the customer; send `discount_amount` = unit × quantity alongside for an older API. */
  items: Array<{ variant_id: string; quantity: number; discount_amount?: number; unit_discount?: number }>;
  /** Omit to let the server price it from settings and the address. */
  delivery_fee?: number;
  /** 'draft' parks the order instead of placing it. */
  status?: 'draft';
  customer_notes?: string;
  admin_notes?: string;
  /**
   * A Home Grocery order: the household's day and part of the day. The API
   * tags it with their plan; refused for a customer who is not a subscriber.
   */
  home_grocery?: { scheduled_for: string; delivery_window?: 'morning' | 'afternoon' | 'evening' | null };
}

export interface CreateAdminOrderResult {
  order: Order;
  /** What the settings and address would have charged. */
  delivery_fee_resolved: string;
  /** What was actually applied — differs when the rep overrode it. */
  delivery_fee_applied: string;
}

export const adminOrders = {
  /**
   * Build an order for a client, the way a rep does sitting with them.
   *
   * Creates at `pending` with stock reserved. Insufficient stock comes back
   * as a 400 carrying `shortfalls`, never as a partial order.
   */
  /**
   * 30s, and an attempt key. A screen that gave up after 10s while the
   * server went on to create the order told the admin it had failed; the
   * retry made a second real order. With the key, a retry gets the first
   * order back (lib/createOrder.ts, replayBuiltOrder).
   */
  create(payload: CreateAdminOrderPayload, idempotencyKey?: string) {
    return api.post<CreateAdminOrderResult>('/api/admin/orders', payload, {
      timeoutMs: 30_000,
      ...(idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : {}),
    });
  },

  list(params: { status?: OrderStatus; q?: string; from?: string; to?: string; riderId?: string; page?: number; limit?: number } = {}) {
    return api.get<Paged<Order>>('/api/admin/orders', params);
  },
  /**
   * The same list, one row per customer purchase instead of one per Order
   * row — see AdminOrderGroup. Paging counts groups, so a page of 20 is 20
   * purchases however many sub-orders they hold between them.
   *
   * A separate method rather than a flag on `list`, because the two return
   * genuinely different shapes and the flat one is still what RidersPage
   * wants for a single rider's recent deliveries.
   */
  listGrouped(params: { status?: OrderStatus; q?: string; from?: string; to?: string; riderId?: string; userId?: string; salesRepId?: string; source?: AdminOrderSource; customerType?: AdminCustomerType; page?: number; limit?: number } = {}) {
    return api.get<Paged<AdminOrderGroup>>('/api/admin/orders', { ...params, grouped: 'true' });
  },
  get(id: string) {
    return api.get<Order>(`/api/admin/orders/${id}`);
  },
  /** The Bill: our company name, the customer's name, lines and totals — nothing else. An order or a purchase id. */
  bill(id: string) {
    return api.get<OrderBill>(`/api/admin/orders/${id}/bill`);
  },
  /**
   * 30s, not the 10s default, like every other call that writes an order:
   * the server may queue for a connection (up to 5s) and then run its
   * transaction (up to 8s). A screen that gives up first is told "failed"
   * about a write that may still land.
   */
  setStatus(id: string, status: OrderStatus, reason?: string, progressKey?: string) {
    return api.put<Order>(`/api/admin/orders/${id}/status`, { status, reason }, {
      timeoutMs: 30_000,
      ...(progressKey ? { headers: { 'X-Progress-Key': progressKey } } : {}),
    });
  },
  assignRider(id: string, riderId: string | null) {
    return api.put<Order>(`/api/admin/orders/${id}/rider`, { riderId });
  },
  updateNotes(id: string, adminNotes: string) {
    return api.put<Order>(`/api/admin/orders/${id}/notes`, { adminNotes });
  },
  /** Resolve a `draft` order: re-checks stock, decrements it, and moves the order to `pending`. */
  confirmStock(id: string) {
    return api.post<Order>(`/api/admin/orders/${id}/confirm-stock`, {}, { timeoutMs: 30_000 });
  },
  /** Soft-delete: hides the order everywhere except a direct id lookup. Restocks its items. */
  deleteOrder(id: string, reason?: string) {
    return api.post<Order>(`/api/admin/orders/${id}/delete`, { reason }, { timeoutMs: 30_000 });
  },
  /** Edit line items (quantity change / replace / remove / add) on an order
   *  still pending/confirmed/preparing. A cross-store add/replace spins off
   *  a new order for that store — see `EditOrderResponse.newOrders`. */
  /**
   * 30s, not the 10s default.
   *
   * The server's edit transaction is budgeted at 8s (lib/editOrder.ts) and the
   * client must outlast it, or the browser hangs up on a transaction that may
   * still commit — the customer is told it failed while the edit lands. The
   * wide margin also means the server budget can be raised later without
   * having to redeploy both apps in lockstep to stay safe.
   */
  editItems(id: string, payload: EditOrderRequest, progressKey?: string) {
    return api.put<EditOrderResponse>(`/api/admin/orders/${id}/items`, payload, {
      timeoutMs: 30_000,
      ...(progressKey ? { headers: { 'X-Progress-Key': progressKey } } : {}),
    });
  },
  /**
   * Re-price delivery on an existing order.
   *
   * Separate from editItems because editOrder.ts deliberately carries the
   * stored fee through untouched; the fee is a judgement about the parcel,
   * not a consequence of the items. Refused once an invoice has been issued,
   * or on a sub-order of a split purchase where the fee lives on the parent.
   */
  /**
   * The buying price of some of this order's lines (admin only; 2026-10-27).
   * The order or a split purchase's id. Changes the order, not the products.
   */
  /** The rep's earning on this order: its own % (null = the rep's usual) and its expenses. */
  setRepEarning(id: string, body: RepOrderEarningInput) {
    return api.put<AdminRepOrderEarning>(`/api/admin/orders/${id}/rep-earning`, body);
  },
  /** Delivered: the earning becomes owed. Approved before and changed since: the difference. */
  approveRepEarning(id: string) {
    return api.post<AdminRepOrderEarning>(`/api/admin/orders/${id}/rep-earning/approve`);
  },
  setItemCosts(id: string, items: Array<{ order_item_id: string; unit_cost: number }>) {
    // `products`: the sizes whose buying price this also set (a line above 0).
    return api.put<{
      items: Array<{ id: string; unit_cost: string }>;
      products?: Array<{ variant_id: string; cost_price: string }>;
    }>(`/api/admin/orders/${id}/item-costs`, { items });
  },
  setDeliveryFee(id: string, deliveryFee: number) {
    return api.put<{ id: string; subtotal: number; delivery_fee: number; total: number }>(
      `/api/admin/orders/${id}/delivery-fee`,
      { delivery_fee: deliveryFee },
    );
  },
  /**
   * Recargo de equivalencia on an order already placed (2026-11-04): on or
   * off. A part of a split purchase, or the purchase's id, changes the whole
   * purchase (`kind: 'purchase'`). Refused once delivered or invoiced.
   */
  setRecargo(id: string, on: boolean) {
    return api.put<{ kind: 'order' | 'purchase'; id: string; recargo: string; total: string }>(
      `/api/admin/orders/${id}/recargo`,
      { on },
    );
  },
};

export interface BulkImportRowResult {
  row: number;
  product_key: string;
  status: 'created' | 'skipped' | 'error' | 'pending_category' | 'duplicate';
  productId?: string;
  productName?: string;
  variantCount?: number;
  error?: string;
  /** When status === 'pending_category', the raw category name queued for review. */
  pending_category_name?: string;
  /** Non-fatal notices — e.g. an unknown shop_name fell back to Cesto. */
  warnings?: string[];
  /** When status === 'duplicate', the id of the existing product/pending row
   *  that this sheet row matched. */
  duplicate_of_id?: string;
  /** 'product' | 'pending' — where the match was found so the admin knows
   *  what to look at. */
  duplicate_of_source?: 'product' | 'pending';
}

export interface BulkImportResult {
  total: number;
  created: number;
  failed: number;
  /** Rows that surfaced a not-yet-existing category. Promote from the Categories page. */
  pending?: number;
  /** Rows skipped because a product with the same name+brand already exists
   *  in either the products table or the pending queue. Prevents the "same
   *  file uploaded twice = 2× catalogue" duplication problem. */
  duplicates?: number;
  results: BulkImportRowResult[];
  /** Brand names used in the sheet that aren't in the curated Top Brands list
   *  yet. Not an error — the import still writes them onto products. Surfaces
   *  as a nudge so the admin can curate them in Home Sections → Top Brands. */
  unknownBrands?: Array<{ name: string; count: number }>;
  /** Same shape as unknownBrands, but for Shop by Origin. */
  unknownOrigins?: Array<{ name: string; count: number }>;
  /** Stores that didn't match any existing row and were auto-created as
   *  is_active=false, source='import' — appear on the /stores Suggestions
   *  filter for admin review. */
  unknownStores?: Array<{ slug: string; name: string; count: number }>;
  /** Product types the importer auto-created (2026-07-17). Land as
   *  is_active=false under the row's subcategory; admin activates on the
   *  Categories page where product types now sit nested. */
  unknownProductTypes?: Array<{ subcategory_id: string; name: string; count: number }>;
  /** Subcategories the importer auto-created (2026-07-24). Land as
   *  is_active=false under the row's category; admin activates on the
   *  Categories page. Before this change, unknown subcategory values
   *  rejected the whole row — now they surface as inactive suggestions. */
  unknownSubcategories?: Array<{ category_id: string; name: string; count: number }>;
}

// ─── Import jobs (Layer 3: background jobs) ─────────────

export type ImportJobStatus = 'queued' | 'running' | 'done' | 'failed' | 'interrupted';

/** POST response — the enqueue endpoint returns the jobId to poll. */
export interface ImportJobEnqueueResult {
  jobId: string;
  /** Present when the server routed us to an existing done job (idempotency replay). */
  replay?: boolean;
  /** Present when the server routed us to an existing queued/running job (concurrent submit). */
  alreadyRunning?: boolean;
  /** Present on a fresh enqueue. */
  status?: ImportJobStatus;
}

/** Full job row shape returned by GET /jobs/:id (also used in the recent-jobs list, minus `result`). */
export interface ImportJob {
  id: string;
  status: ImportJobStatus;
  processed: number;
  total: number | null;
  result?: BulkImportResult | null;
  error_message: string | null;
  filename: string;
  file_size: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface AdminProductDuplicateEntry {
  id: string;
  name_es: string;
  name_en: string;
  brand: string | null;
  is_active: boolean;
  category_id: string;
  created_at: string;
  variant_count: number;
  image_count: number;
  /** How many past OrderItems reference this product. Non-zero = deactivate (preserves history) instead of hard-delete. */
  order_item_count: number;
  /** Rashan pack names that reference this product via their items JSON.
   *  Non-empty = resolve will SKIP this product (deletion would orphan the
   *  reference). Admin must remove from packs first. */
  rashan_pack_names?: string[];
  /** URL of the product's primary image, if any. Shown as a thumbnail on
   *  the duplicates page so admins can visually confirm a match. */
  primary_image_url?: string | null;
  /** Name of the default variant (or first variant) — the size/pack marker
   *  that turns "same name" into "yes, same product". */
  first_variant_name?: string | null;
  /** FK to the store this product belongs to. Null = Cesto (the default
   *  house shop). Used by the duplicates page to flag multi-store listings
   *  as intentional rather than destructive duplicates. */
  store_id?: string | null;
  store?: { id: string; slug: string; name: string } | null;
  /** Full variant list — drives the side-by-side comparison view AND the
   *  Merge Variants action (which reassigns variant.product_id from
   *  removed products to the canonical). */
  variants?: DuplicateVariantSnapshot[];
}

/** Why a group of products was flagged as duplicates. Legacy union — the
 *  current detection algorithm groups by full identity (name + brand +
 *  origin + category + subcategory + product_type), so match_reasons is
 *  no longer populated. Kept in the union for backwards-compat with older
 *  admin bundles that still render the pills. */
export type DuplicateMatchReason = 'same_name' | 'same_brand_variant' | 'same_image';

export interface AdminProductDuplicateGroup {
  /** Stable identifier for the group (opaque — not user-facing). */
  key: string;
  /** The best-guess display label for the group (typically the most-common
   *  normalized name amongst its products). Admin-friendly. */
  label: string;
  /** Which signals overlap across the group. Now optional — the identity-
   *  based algorithm groups on ALL identity fields at once, so per-signal
   *  reasons became redundant. Older bundles still render the chips if the
   *  API happens to emit them. */
  match_reasons?: DuplicateMatchReason[];
  /** True when the group's products span ≥2 distinct stores (Cesto default
   *  counts as its own store). Under the current rule these appear in the
   *  separate `multi_store_listings` array, NOT in `groups`; kept on the
   *  entry shape so multi-store cards can render the same UI. */
  is_cross_store: boolean;
  products: AdminProductDuplicateEntry[];
}

export interface AdminProductDuplicatesResponse {
  /** Real duplicates — products in the SAME store that share identity
   *  fields. Actionable: admin picks a canonical and deletes/merges the
   *  rest. */
  groups: AdminProductDuplicateGroup[];
  /** Same identity fields but products live in DIFFERENT stores. Not
   *  duplicates per the current rule — surfaced as an inventory view so
   *  admin can see which products are stocked across multiple stores.
   *  Optional so an older API without this field still deserialises. */
  multi_store_listings?: AdminProductDuplicateGroup[];
  total_groups: number;
  total_duplicate_products: number;
  /** Counts for the multi-store listings section. Optional for the same
   *  backwards-compat reason as `multi_store_listings`. */
  total_multi_store_groups?: number;
  total_multi_store_products?: number;
}

/** Resolve response — carries per-row outcomes so the UI can surface
 *  skipped and failed rows instead of pretending everything succeeded. */
export interface ResolveDuplicatesResult {
  groups_processed: number;
  deactivated: number;
  deleted: number;
  /** Products the server refused to touch — e.g. referenced by a rashan
   *  pack. Admin must fix those before retrying. */
  skipped: Array<{ id: string; reason: string }>;
  /** Products where the hard-delete threw (e.g. FK we didn't foresee).
   *  Surfacing these instead of swallowing to console. */
  failed: Array<{ id: string; error: string }>;
}

/** Merge-variants response — same shape as resolve but reports how many
 *  variants + images were reassigned to the canonical. */
export interface MergeDuplicatesResult {
  groups_processed: number;
  merged_variants: number;
  merged_images: number;
  deleted: number;
  skipped: Array<{ id: string; reason: string }>;
  failed: Array<{ id: string; error: string }>;
}

/** A single variant on a duplicate-detection product entry. Enough info
 *  for the side-by-side comparison view (price, stock, sku) but not the
 *  full ProductVariant shape. Decimal prices come across as strings so
 *  the JSON is portable — the UI stringifies for display anyway. */
export interface DuplicateVariantSnapshot {
  id: string;
  name_es: string;
  name_en: string;
  price: string;
  compare_at_price: string | null;
  b2b_price: string | null;
  stock_quantity: number;
  sku: string | null;
  is_default: boolean;
  is_active: boolean;
}

// ─── Import duplicates (queued for admin review) ───────
// Rows the Excel importer flagged as duplicates of an existing product —
// stored so admin can Create Anyway or Dismiss on the Duplicates page →
// "From Excel import" tab.

export type ImportDuplicateStatus = 'pending' | 'created' | 'dismissed';

/** A single variant inside the stored importer payload. Same shape as
 *  the CSV/XLSX importer's internal `ParsedVariant`. */
export interface ImportDuplicateVariantPayload {
  name_es: string;
  name_en: string;
  price: number;
  compare_at_price: number | null;
  b2b_price: number | null;
  stock_quantity: number;
  low_stock_threshold: number;
  sku: string | null;
  is_default: boolean;
  is_active: boolean;
}

/** The full stored payload — enough to re-create the product on Create
 *  Anyway. Keep in sync with the payload the API stores at
 *  packages/api/src/routes/admin/productsImport.ts (search for
 *  `productImportDuplicate.create`). */
export interface ImportDuplicatePayload {
  name_es: string;
  name_en: string;
  description_es: string | null;
  description_en: string | null;
  brand: string | null;
  origin: string | null;
  brand_id: string | null;
  origin_id: string | null;
  category_id: string | null;
  subcategory_id: string | null;
  product_type_id: string | null;
  store_id: string | null;
  store_slug?: string | null;
  is_active: boolean;
  is_featured: boolean;
  variants: ImportDuplicateVariantPayload[];
  image_urls: string[];
}

/** A pending / resolved import duplicate row. `matched_product` may be
 *  null when the target was deleted after the row was queued — the
 *  `matched_product_name` snapshot stays readable. */
export interface ProductImportDuplicate {
  id: string;
  job_id: string;
  source_row_number: number;
  payload: ImportDuplicatePayload;
  matched_product_id: string | null;
  matched_product_name: string;
  status: ImportDuplicateStatus;
  created_at: string;
  resolved_at: string | null;
  matched_product: {
    id: string;
    name_es: string;
    name_en: string;
    brand: string | null;
    origin: string | null;
    is_active: boolean;
    store: { id: string; slug: string; name: string } | null;
    images: { url: string }[];
    _count: { variants: number };
  } | null;
  job: {
    id: string;
    filename: string;
    created_at: string;
    admin: { id: string; name: string; email: string } | null;
  } | null;
}

export interface ProductImportDuplicatesResponse {
  items: ProductImportDuplicate[];
  total: number;
}

/** All filter dimensions supported by GET /api/admin/products. Every field
 *  is optional — omitted keys are ignored server-side. Booleans use the
 *  string 'true'/'false' shape the backend Zod schema expects (URL-safe
 *  and doesn't get lost by URLSearchParams stringification). */
/** Booleans accepted as either raw booleans or the 'true'/'false' string
 *  shape the backend Zod schema expects. The api client's URLSearchParams
 *  stringifies both, so callers can use whichever reads cleaner in context. */
type BoolFlag = boolean | 'true' | 'false';

export interface AdminProductsListParams {
  q?: string;
  categoryId?: string;
  subcategoryId?: string;
  productTypeId?: string;
  /** Store uuid, or the literal 'cesto' to scope to house-store products
   *  (Product.store_id NULL) — a query string can't carry a real null. */
  storeId?: string | 'cesto';
  brandId?: string;
  originId?: string;
  isActive?: BoolFlag;
  isFeatured?: BoolFlag;
  isVerified?: BoolFlag;
  isTopSeller?: BoolFlag;
  isSponsored?: BoolFlag;
  /** The quick-create review queue — rows a rep added that a catalogue
   *  admin still has to finish. */
  reviewNeeded?: BoolFlag;
  /** Tri-state stock filter. Supersedes the legacy `lowStock` boolean. */
  stock?: 'in' | 'out' | 'low';
  /** @deprecated — use `stock: 'low'`. Kept for in-flight bundles. */
  lowStock?: BoolFlag;
  hasOrders?: BoolFlag;
  /** Exactly this setting — the table's "Shown to" filter. */
  audience?: ProductAudience;
  /** What one kind of customer is shown (both + their own) — for the order builder. */
  shownTo?: 'b2c' | 'b2b';
  sort?: 'newest' | 'oldest' | 'name_asc' | 'name_desc' | 'rating_desc';
  page?: number;
  limit?: number;
  /** Widen the row with the fields only the bulk-edit grid needs. */
  full?: '1' | 'true';
  /** Comma-separated product ids. Caps at BULK_EDIT_MAX_PRODUCTS server-side. */
  ids?: string;
}

/** Max products the bulk-edit grid loads. Mirrors the server-side cap. */
export const BULK_EDIT_MAX_PRODUCTS = 250;

export interface AdminVariantPatch {
  id: string;
  name_es?: string;
  price?: number;
  compare_at_price?: number | null;
  b2b_price?: number | null;
  /** The buying price (admin only). */
  cost_price?: number;
  stock_quantity?: number;
  low_stock_threshold?: number;
  is_default?: boolean;
  sku?: string | null;
}

export interface AdminProductPatch {
  name_es?: string;
  name_en?: string;
  description_es?: string | null;
  description_en?: string | null;
  brand?: string | null;
  origin?: string | null;
  store_id?: string | null;
  category_id?: string;
  subcategory_id?: string | null;
  product_type_id?: string | null;
  is_active?: boolean;
  is_featured?: boolean;
  is_verified?: boolean;
  is_top_seller?: boolean;
  is_sponsored?: boolean;
  is_new_arrival?: boolean;
  rating?: number | null;
  rating_count?: number;
}

export interface AdminBulkUpdateItem {
  id: string;
  product?: AdminProductPatch;
  variants?: AdminVariantPatch[];
}

export interface AdminBulkUpdateResult {
  updated: number;
  variants_updated: number;
  failed: Array<{ id: string; error: string }>;
}

/**
 * Which order book a list is asking for. Omitted means both.
 *
 * `customer` = placed by the shopper. `rashan` = built by a rep in admin on
 * their behalf. Backed by Order.created_by_admin_id, not a new column.
 */
/**
 * Who PUT THE ORDER TOGETHER.
 *
 *   customer   — the shopper placed it themselves.
 *   admin      — we built it for them: staff in the panel OR a sales rep.
 *   sales_rep  — a sales rep specifically. A SUBSET of `admin`, not a
 *                sibling of it, which is the whole point: it answers "which
 *                of these did a rep build" without taking those orders out
 *                of the book they already belong to.
 *
 * `rashan` is the old name for `admin`; the API still accepts it, nothing
 * sends it.
 */
export type AdminOrderSource = 'customer' | 'admin' | 'sales_rep';

/**
 * Who the order or account is FOR — a wholesale buyer, or an ordinary shopper.
 * Independent of AdminOrderSource, which is about who placed it.
 */
export type AdminCustomerType = 'retail' | 'b2b';

/**
 * Which slice of the user base a list is asking for — one per tab on /users.
 * `customers` excludes rashan accounts, which have their own tab; `partner`
 * excludes nothing, because owning a store is independent of how you buy.
 */
export type AdminUserSegment = 'customers' | 'b2b' | 'rashan' | 'partner';

/** A staff account — someone who logs into the admin panel. */
export interface AdminStaff {
  id: string;
  name: string;
  email: string;
  role: AdminRole;
  is_active: boolean;
  last_login_at: string | null;
  /** null = never rotated, so the login flow forces one. */
  password_changed_at: string | null;
  created_at: string;
}

export const adminStaff = {
  list(params: { q?: string; role?: AdminRole; status?: 'active' | 'disabled'; page?: number; limit?: number } = {}) {
    return api.get<Paged<AdminStaff>>('/api/admin/staff', params);
  },
  /** The temp password comes back ONCE — there is no mail path for staff. */
  create(payload: { name: string; email: string; role: AdminRole }) {
    return api.post<{ admin: AdminStaff; temp_password: string }>('/api/admin/staff', payload);
  },
  update(id: string, payload: { name?: string; role?: AdminRole; is_active?: boolean }) {
    return api.put<AdminStaff>(`/api/admin/staff/${id}`, payload);
  },
  resetPassword(id: string) {
    return api.post<{ temp_password: string }>(`/api/admin/staff/${id}/reset-password`, {});
  },
};

export interface AdminBulkActionPayload {
  /**
   * `set_vat` writes the IVA band AND marks it reviewed, which is what makes
   * the products invoiceable. Filter-scoped by design: the band follows the
   * category, so "all of Bakery at 4%" is the real unit of work.
   */
  action: 'activate' | 'deactivate' | 'delete' | 'set_vat' | 'set_audience';
  /** Explicit selection. Mutually exclusive with `filter`. */
  ids?: string[];
  /** Select-all-matching. Resolved to a `where` server-side. */
  filter?: Omit<AdminProductsListParams, 'sort' | 'page' | 'limit' | 'full' | 'ids'>;
  /** Required for `set_vat`, ignored otherwise. */
  vat_category?: VatCategory;
  /** Required for `set_audience`: who the shop shows them to. */
  audience?: ProductAudience;
}

export interface AdminBulkActionResult {
  matched: number;
  updated: number;
  /**
   * `set_audience` to B2B only: products left as they were because a size
   * has no B2B price — how many, and the first 50 by name.
   */
  needs_b2b_price?: number;
  needs_b2b_price_products?: Array<{ id: string; name_es: string }>;
}

/**
 * Everything quick-create asks for, and nothing else.
 *
 * `vat_category` is required with no default on purpose: every other path
 * leaves products on the unreviewed 10% default, and this is the one moment
 * a human is holding the item and can answer.
 */
export interface QuickCreateProductPayload {
  name_es: string;
  name_en: string;
  category_id: string;
  brand?: string;
  /** null = the Cesto house store. */
  store_id?: string | null;
  vat_category: VatCategory;
  price: number;
  b2b_price?: number | null;
  stock_quantity?: number;
  sku?: string;
  image_url?: string;
}

export const adminProducts = {
  list(params: AdminProductsListParams = {}) {
    // Cast to loosen the strict param type for the api client's Record<> query
    // shape. AdminProductsListParams is a strict named union of allowed keys,
    // which doesn't structurally satisfy an open index signature.
    return api.get<Paged<Product>>('/api/admin/products', params as Record<string, string | number | boolean | undefined | null>);
  },
  get(id: string) {
    return api.get<Product>(`/api/admin/products/${id}`);
  },

  /**
   * Same endpoint as `list`, but with the wider select the bulk-edit grid
   * needs (descriptions, taxonomy ids, variant names + sku). Heavier rows and
   * a higher limit, so it gets a longer timeout than the 10s default.
   */
  listFull(params: AdminProductsListParams = {}) {
    return api.get<Paged<Product>>(
      '/api/admin/products',
      { ...params, full: '1' } as Record<string, string | number | boolean | undefined | null>,
      { timeoutMs: 30_000 },
    );
  },

  /** Partial patch across many products. Chunk callers at ~50 items. */
  bulkUpdate(items: AdminBulkUpdateItem[]) {
    return api.post<AdminBulkUpdateResult>('/api/admin/products/bulk', { items }, { timeoutMs: 120_000 });
  },

  /** One-click action over an id list or a whole filter. */
  bulkAction(payload: AdminBulkActionPayload) {
    return api.post<AdminBulkActionResult>('/api/admin/products/bulk/action', payload, { timeoutMs: 120_000 });
  },
  create(payload: Partial<Product> & { variants: unknown[]; images: unknown[] }) {
    return api.post<Product>('/api/admin/products', payload);
  },
  /**
   * The twenty-second path, for a rep holding a product at a counter.
   *
   * Creates a real, immediately sellable product from a handful of fields,
   * flagged `review_needed` so a catalogue admin completes it later. Not a
   * shortcut around the full form — a different job.
   */
  quickCreate(payload: QuickCreateProductPayload) {
    return api.post<Product>('/api/admin/products/quick', payload);
  },
  /**
   * Who the shop shows it to — from the products table, without the whole
   * form. B2B only needs a B2B price on every size: send the missing ones
   * along, and both land together.
   */
  setAudience(id: string, audience: ProductAudience, b2bPrices?: Array<{ variant_id: string; b2b_price: number }>) {
    return api.put<{ id: string; audience: ProductAudience }>(`/api/admin/products/${id}/audience`, {
      audience,
      ...(b2bPrices?.length ? { b2b_prices: b2bPrices } : {}),
    });
  },
  /** Clears `review_needed`. Deliberate action, never a side-effect of save. */
  markReviewed(id: string) {
    return api.put<{ id: string; review_needed: boolean }>(`/api/admin/products/${id}/reviewed`, {});
  },
  update(id: string, payload: Partial<Product> & { variants: unknown[]; images: unknown[] }) {
    return api.put<Product>(`/api/admin/products/${id}`, payload);
  },
  remove(id: string, opts?: { permanent?: boolean }) {
    const qs = opts?.permanent ? '?permanent=true' : '';
    return api.delete<{ message: string; permanent: boolean }>(`/api/admin/products/${id}${qs}`);
  },

  /**
   * Nuclear delete. Erases the product AND every order that ever contained
   * it, plus rashan pack/subscription references. Use only when the intent
   * is a total scrub — order history that touched this product disappears.
   */
  purge(id: string) {
    return api.post<{
      message: string;
      orders_deleted: number;
      rashan_packs_updated: number;
      rashan_subscriptions_updated: number;
    }>(`/api/admin/products/${id}/purge`);
  },

  /** Duplicate detection — groups sharing a normalised name. */
  listDuplicates() {
    return api.get<AdminProductDuplicatesResponse>('/api/admin/products/duplicates');
  },

  // ─── Import duplicates (staged for review) ─────────
  /** Pending Excel-import duplicates awaiting Create Anyway / Dismiss. */
  listImportDuplicates(status: ImportDuplicateStatus | 'all' = 'pending') {
    return api.get<ProductImportDuplicatesResponse>(
      '/api/admin/products/import-duplicates',
      { status },
    );
  },
  /** Create the actual Product from the stored payload. */
  createFromImportDuplicate(id: string) {
    return api.post<{ id: string; name_es: string; created: true }>(
      `/api/admin/products/import-duplicates/${id}/create`,
      {},
    );
  },
  /** Soft-delete — marks row `dismissed`. */
  dismissImportDuplicate(id: string) {
    return api.post<{ id: string; dismissed: true }>(
      `/api/admin/products/import-duplicates/${id}/dismiss`,
      {},
    );
  },
  /** Bulk dismiss. Pass a subset of ids to target them; omit for "all
   *  pending rows". Server returns how many rows actually flipped. */
  dismissAllImportDuplicates(ids?: string[]) {
    return api.post<{ dismissed: number }>(
      '/api/admin/products/import-duplicates/dismiss-all',
      ids && ids.length > 0 ? { ids } : {},
    );
  },

  /**
   * Resolve duplicates in bulk. Each remove_id is deactivated if it has
   * any OrderItem history, hard-deleted otherwise. Server picks per row.
   */
  resolveDuplicates(payload: { groups: Array<{ keep_id: string; remove_ids: string[] }> }) {
    return api.post<ResolveDuplicatesResult>('/api/admin/products/duplicates/resolve', payload);
  },

  /**
   * Merge variants + images from `remove_ids` INTO `keep_id`, then delete
   * the now-empty products. Preserves OrderItem history because we only
   * reassign variant.product_id (variant.id doesn't change).
   */
  mergeDuplicates(payload: { groups: Array<{ keep_id: string; remove_ids: string[] }> }) {
    return api.post<MergeDuplicatesResult>('/api/admin/products/duplicates/merge', payload);
  },

  // ─── Bulk import (background jobs) ──────────────────
  // POST enqueues an import job and returns a jobId — the caller polls
  // getImportJob(jobId) until status === 'done' | 'failed' | 'interrupted'.
  // The final BulkImportResult lives at job.result once done.
  async importFromXlsx(file: File): Promise<ImportJobEnqueueResult> {
    const form = new FormData();
    form.append('file', file);

    // SHA-256 the file bytes into an Idempotency-Key so a same-file resubmit
    // within the server's replay window (1h) returns the ORIGINAL job's id
    // instead of running a second import. Falls back to a name+size stamp
    // when SubtleCrypto isn't available (very old browsers, tests).
    let idempotencyKey: string;
    try {
      const buf = await file.arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', buf);
      idempotencyKey = Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    } catch {
      idempotencyKey = `${file.name}-${file.size}-${Date.now()}`;
    }

    return api.post<ImportJobEnqueueResult>('/api/admin/products/import', form, {
      multipart: true,
      // Upload itself is short (the server hands off to a background worker
      // immediately). 30s is plenty even on very slow connections.
      timeoutMs: 30_000,
      headers: { 'Idempotency-Key': idempotencyKey },
    });
  },

  /** Poll a single import job. Returns null if not found (404). */
  getImportJob(jobId: string): Promise<ImportJob> {
    return api.get<ImportJob>(`/api/admin/products/import/jobs/${jobId}`);
  },

  /** Recent import jobs for the signed-in admin. */
  listImportJobs(limit = 10): Promise<ImportJob[]> {
    return api.get<ImportJob[]>('/api/admin/products/import/jobs', { limit });
  },

  // The template endpoint streams a binary xlsx — bypass the JSON helpers
  // and trigger a browser download.
  async downloadTemplate(): Promise<void> {
    const baseUrl = getApiBaseUrl();
    const token = await getTokenStorage().getAccessToken();
    const res = await fetch(`${baseUrl}/api/admin/products/import/template`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      throw new Error(`Template download failed (${res.status})`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'products-import-template.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  /**
   * Trigger a browser download of the current admin product catalogue as
   * CSV or XLSX. Accepts the same filter dimensions as `list()` so exports
   * respect whatever the admin has narrowed to on the ProductsPage — pass
   * the exact same params object.
   *
   * The server caps exports at 20,000 rows and returns a 413 with a
   * "narrow your filters" message above that. We surface that as a
   * thrown Error so the caller can toast it.
   */
  async downloadExport(
    params: AdminProductsListParams & { format: 'csv' | 'xlsx' },
  ): Promise<void> {
    const baseUrl = getApiBaseUrl();
    const token = await getTokenStorage().getAccessToken();

    const search = new URLSearchParams();
    // Coerce every value to string; skip undefined/empty so we don't send
    // ?categoryId= which the Zod schema would reject as not-a-uuid.
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') continue;
      search.append(key, String(value));
    }

    const url = `${baseUrl}/api/admin/products/export?${search.toString()}`;
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });

    if (!res.ok) {
      // Try to pull the JSON error message the API sends on 4xx before
      // falling back to a status-only message.
      let message = `Export failed (${res.status})`;
      try {
        const body = await res.json();
        if (body && typeof body.error === 'string') message = body.error;
      } catch { /* not JSON — keep the status message */ }
      throw new Error(message);
    }

    // Prefer the server-sent filename if present so date-stamping stays
    // consistent with what the backend generated.
    const disposition = res.headers.get('content-disposition') ?? '';
    const nameMatch = /filename="([^"]+)"/.exec(disposition);
    const filename = nameMatch?.[1]
      ?? `products-export.${params.format === 'csv' ? 'csv' : 'xlsx'}`;

    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objUrl);
  },
};

export const adminCategories = {
  list() {
    return api.get<(Category & { _count: { subcategories: number; products: number } })[]>('/api/admin/categories');
  },
  create(payload: Partial<Category>) {
    return api.post<Category>('/api/admin/categories', payload);
  },
  update(id: string, payload: Partial<Category>) {
    return api.put<Category>(`/api/admin/categories/${id}`, payload);
  },
  remove(id: string, reassignTo?: string) {
    const qs = reassignTo ? `?reassignTo=${encodeURIComponent(reassignTo)}` : '';
    return api.delete<{ message: string; moved: number }>(`/api/admin/categories/${id}${qs}`);
  },
  listSubcategories() {
    return api.get<(SubCategory & { category: { id: string; name_es: string } })[]>('/api/admin/categories/subcategories/all');
  },
  createSubcategory(payload: Partial<SubCategory>) {
    return api.post<SubCategory>('/api/admin/categories/subcategories', payload);
  },
  updateSubcategory(id: string, payload: Partial<SubCategory>) {
    return api.put<SubCategory>(`/api/admin/categories/subcategories/${id}`, payload);
  },
  removeSubcategory(id: string) {
    return api.delete<{ message: string }>(`/api/admin/categories/subcategories/${id}`);
  },

  // ─── Pending (queued from Excel import) ──
  listPending() {
    return api.get<PendingCategory[]>('/api/admin/categories/pending');
  },
  dismissPending(id: string) {
    return api.delete<{ message: string }>(`/api/admin/categories/pending/${id}`);
  },

  // ─── Pending products parked under a (now-existing) Category ──
  listPendingProducts(categoryId: string) {
    return api.get<PendingProduct[]>(`/api/admin/categories/${categoryId}/pending-products`);
  },
  publishPendingProducts(categoryId: string, ids: string[], subcategoryId?: string | null) {
    return api.post<{
      published: number;
      failed: number;
      results: Array<{
        id: string;
        product_key: string;
        name_es: string;
        status: 'published' | 'error';
        productId?: string;
        error?: string;
      }>;
    }>(`/api/admin/categories/${categoryId}/pending-products/publish`, {
      ids,
      subcategory_id: subcategoryId ?? null,
    });
  },
  dismissPendingProduct(id: string) {
    return api.delete<{ message: string }>(`/api/admin/categories/pending-products/${id}`);
  },

  // ─── Partner submissions (approval queue) ──
  listPartnerSubmissions(status: CategoryApprovalStatus = 'pending') {
    return api.get<Category[]>('/api/admin/categories/partner-submissions', { status });
  },
  approve(id: string, patch?: Partial<Category>) {
    return api.post<Category>(`/api/admin/categories/${id}/approve`, patch ?? {});
  },
  reject(id: string, reason: string) {
    return api.post<Category>(`/api/admin/categories/${id}/reject`, { reason });
  },
};

export const adminBanners = {
  list() { return api.get<Banner[]>('/api/admin/banners'); },
  create(payload: Partial<Banner>) { return api.post<Banner>('/api/admin/banners', payload); },
  update(id: string, payload: Partial<Banner>) { return api.put<Banner>(`/api/admin/banners/${id}`, payload); },
  remove(id: string) { return api.delete<{ message: string }>(`/api/admin/banners/${id}`); },
};

// There is no adminZones or adminStoreZones. Delivery coverage was removed
// on 2026-08-31: no service areas, and one platform-wide delivery fee that
// lives in the Settings blob (adminSettings) rather than per zone.

export interface RiderSubscriptionDeliveryRow {
  id: string;
  subscription_id: string;
  scheduled_date: string;
  status: import('./rashan').SubDeliveryStatus;
  item_count: number;
  total: number;
  subscription: {
    id: string;
    pack: { name_es: string; name_en: string; slug: string } | null;
    user: { id: string; name: string; phone: string | null };
    address: { street_line_1: string; city: string };
  };
  order: { id: string; order_number: string; status: string } | null;
}

export const adminRiders = {
  list(activeOnly?: boolean) {
    return api.get<(Rider & { _count: { orders: number; subscription_deliveries: number } })[]>('/api/admin/riders', { activeOnly });
  },
  create(payload: Partial<Rider>) { return api.post<Rider>('/api/admin/riders', payload); },
  update(id: string, payload: Partial<Rider>) { return api.put<Rider>(`/api/admin/riders/${id}`, payload); },
  remove(id: string) { return api.delete<{ message: string }>(`/api/admin/riders/${id}`); },
  subscriptionDeliveries(id: string) {
    return api.get<RiderSubscriptionDeliveryRow[]>(`/api/admin/riders/${id}/subscription-deliveries`);
  },
};

export interface AdminUserRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  /**
   * The BUSINESS contact number, off BusinessProfile — not the person's own.
   *
   * Approving a B2B lead records the number it collected here and leaves
   * `phone` null, so for a wholesale account this is usually the only one
   * there is. Kept separate from `phone` rather than merged into it, because
   * they are different things and only one of them is the user's.
   *
   * Optional: an API deployed before this shipped does not send it, so a
   * screen must treat `undefined` as "not known" and not as "none".
   */
  contact_phone?: string | null;
  /**
   * The number on their delivery address.
   *
   * A retail customer is never asked for a phone when signing up — email and
   * Google both take a name, an email and a password — so this is the only
   * one most of them have, and only once they have saved an address.
   *
   * Optional, like the others: an older API does not send it, and undefined
   * means "not known", never "none".
   */
  address_phone?: string | null;
  /** Trading name, off BusinessProfile. Null for a retail account. */
  company?: string | null;
  /**
   * Set for a Home Grocery subscriber — an approved /rashan request.
   * `contact_phone` is the number from their form, which never reaches
   * `phone` (unique on users, and requests repeat numbers). Optional: an
   * API deployed before the revamp does not send it.
   */
  home_grocery?: {
    contact_phone: string | null;
    household_size: number;
    frequency: import('./rashanLeads').RashanLeadFrequency;
    approved_at: string;
  } | null;
  /** Their Home Grocery plan, on the Home Grocery tab only (`segment: 'rashan'`). */
  home_grocery_plan?: import('./homeGroceryPlan').PlanSummary | null;
  status: 'active' | 'blocked';
  created_at: string;
  last_order_at: string | null;
  /** Wholesale account. Optional: an API deployed before B2B lists shipped. */
  is_business?: boolean;
  pricing_mode?: 'retail' | 'b2b';
  /** Non-empty when this customer also owns a store. */
  partner_roles?: Array<{
    store_id: string;
    role: string;
    store?: { name: string; slug: string } | null;
  }>;
  _count: { orders: number; addresses: number };
  /**
   * How many times they have BOUGHT, which is not `_count.orders`.
   *
   * A split checkout is several Order rows and one purchase. The row count
   * reads 7 for a customer who has ordered twice, which is not what anyone
   * means by "orders" in a customer list. Optional, because an API deployed
   * before this sends no such field — read it with `?? _count.orders`.
   */
  purchase_count?: number;
}

/**
 * Everything the admin customer page shows, from one GET.
 *
 * `orders` is the ten most recent PURCHASES, not order rows: a split
 * checkout is several Order rows and listing them separately makes one
 * purchase look like three. `stats.orders.total` is still a count of rows.
 */
export interface AdminUserDetail extends Omit<User, 'orders'> {
  /**
   * The rep who signed this client up, as free text.
   *
   * Null for self-registered customers. Optional on the type because an API
   * deployed before this shipped does not send it — frontend and API deploy
   * independently, so the older shape has to stay readable.
   */
  sales_manager_name?: string | null;
  /** The admin who opened the account, when one did. */
  created_by_admin?: { id: string; name: string } | null;
  /**
   * The sales rep who opened it, when one did. Mutually exclusive with
   * created_by_admin — at most one of the two is ever set — but both are
   * optional, because an API deployed before this shipped sends neither.
   */
  created_by_sales_rep?: { id: string; name: string } | null;
  /**
   * The household details ops build the month's order from — set once a
   * Home Grocery request is approved. Optional: older APIs omit it.
   */
  home_grocery_profile?: {
    household_size: number;
    adults: number | null;
    children: number | null;
    frequency: import('./rashanLeads').RashanLeadFrequency;
    preferred_slot: string | null;
    dietary_notes: string | null;
    /** Serialised Prisma Decimal — a string over the wire. */
    budget_per_cycle: string | null;
    contact_phone: string | null;
    approved_at: string;
    source_lead: { id: string; created_at: string } | null;
  } | null;
  addresses: import('../../types').Address[];
  orders: {
    /** Navigate here — the parent's id for a split, else the order's own.
     *  GET /api/admin/orders/:id resolves either shape. */
    id: string;
    order_number: string;
    status: import('../../types').OrderStatus;
    total: number;
    created_at: string;
    /** True when a ParentOrder backs this purchase. */
    is_split?: boolean;
    /** How many Order rows it is stored as. */
    part_count?: number;
    /** Items across every part. */
    item_count?: number;
    /** Distinct shops; `null` is the Cesto house store. */
    stores?: Array<{ id: string; name: string } | null>;
    /** Pre-grouping shape, from an API deployed before this shipped. */
    store?: { id: string; name: string } | null;
    _count?: { items: number };
    /** A Home Grocery plan's delivery. Optional: an older API omits it. */
    plan?: { scheduled_for: string | null; skipped: boolean } | null;
  }[];
  /** Present when the account signed up through Google rather than a
   *  password. Not on the public `User` shape — only admin surfaces it, to
   *  answer "why can't they reset their password?". */
  google_id?: string | null;
  /** Why this account was blocked, written for the customer to read. Null
   *  whenever the account is active — it is cleared on unblock. */
  blocked_reason?: string | null;
  blocked_at?: string | null;
  subscriptions?: {
    id: string;
    status: string;
    frequency: string;
    next_delivery_date: string | null;
    pack_slug: string | null;
    created_at: string;
    cancelled_at: string | null;
    store?: { id: string; name: string } | null;
  }[];
  reviews?: {
    id: string;
    rating: number;
    title: string | null;
    created_at: string;
    is_hidden: boolean;
    product?: { id: string; name_es: string } | null;
  }[];
  /**
   * Optional throughout: an API deployed before this shipped sends none of
   * it, and the page has to render against that rather than crash on a
   * missing `stats.orders`.
   */
  stats?: {
    orders: {
      /** Order ROWS — a split checkout counts once per part. */
      total: number;
      /** Distinct purchases, which is what `orders` above lists. Absent from
       *  an API deployed before grouping shipped. */
      purchases?: number;
      /** Keyed by OrderStatus; a status with no orders is simply absent. */
      byStatus: Record<string, number>;
      /** Orders that were not cancelled — the denominator for spend. */
      paid: number;
    };
    lifetimeSpend: number;
    /** Null for a customer who has never ordered — an average of nothing is
     *  not zero, and "€0.00" would read as though they had spent nothing. */
    averageOrderValue: number | null;
    firstOrderAt: string | null;
    lastOrderAt: string | null;
    /** What is in their basket right now, unordered. */
    cart: { items: number; value: number };
  };
  _count: { orders: number; addresses?: number; product_reviews?: number };
}

export interface AdminUserLookup {
  email: {
    id: string; name: string; status: 'active' | 'blocked'; is_business: boolean;
    /** How they sign in — whether a password of their own would stand. Absent on an API from before 2026-10-31. */
    access?: 'none' | 'temporary' | 'own';
    /** The stores they already manage. */
    partner_stores?: Array<{ id: string; name: string }>;
  } | null;
  phone: { id: string; name: string } | null;
}

export const adminUsers = {
  list(params: { q?: string; status?: 'active' | 'blocked'; segment?: AdminUserSegment; customerType?: AdminCustomerType; role?: 'partner'; page?: number; limit?: number } = {}) {
    return api.get<Paged<AdminUserRow>>('/api/admin/users', params);
  },
  get(id: string) { return api.get<AdminUserDetail>(`/api/admin/users/${id}`); },
  /** The prices agreed with this customer — euros off one unit per product size. */
  productDiscounts(id: string) { return api.get<CustomerProductDiscount[]>(`/api/admin/users/${id}/product-discounts`); },
  /** Forget one: the next order starts that product at its normal price. */
  removeProductDiscount(id: string, variantId: string) {
    return api.delete<{ removed: true }>(`/api/admin/users/${id}/product-discounts/${variantId}`);
  },
  /**
   * Is this email or phone already taken? Asked while the rep types, not at
   * submit.
   *
   * The two results mean different things. An existing email is NOT a
   * problem — `createClient` upgrades that account — so it should read as
   * "this person already exists". An existing phone IS a hard stop, because
   * User.phone is unique and cannot be reassigned.
   */
  lookup(params: { email?: string; phone?: string }) {
    return api.get<AdminUserLookup>('/api/admin/users/lookup', params);
  },
  /** `reason` is REQUIRED when blocking — the customer is shown it, on the
   *  login screen and in the dialog that ends their session. */
  setStatus(id: string, status: 'active' | 'blocked', reason?: string) {
    return api.put<User>(`/api/admin/users/${id}/status`, { status, reason });
  },
  /** Honours an account-deletion request received by email. super_admin only. */
  erase(id: string) {
    return api.delete<{ message: string; mode: 'hard' | 'soft'; preservedOrders?: number }>(`/api/admin/users/${id}`);
  },

  /**
   * Open an account on a client's behalf, the way a rep does in the shop.
   *
   * `email` is required even though User.email is nullable in general: it is
   * where the credentials go. The address is required because an Order cannot
   * exist without one, and the rep is standing there.
   *
   * `email_sent: false` in the response means the rows committed but the mail
   * did not go out — recover with `resendCredentials`, do not create a second
   * client.
   */
  createClient(payload: CreateClientPayload) {
    return api.post<CreateClientResult>('/api/admin/users', payload);
  },
  /** Narrow by design: status has its own endpoint with its own rules. */
  update(id: string, payload: AdminUserPatch) {
    return api.put<User>(`/api/admin/users/${id}`, payload);
  },
  createAddress(id: string, payload: ClientAddressPayload) {
    return api.post<Address>(`/api/admin/users/${id}/addresses`, payload);
  },
  /**
   * Issue the customer a new password, and either mail it or hand it back.
   *
   * The previous password stops working the moment this returns, and every
   * session they have is ended with it — see AdminResendCredentialsResult.
   * `sendEmail: false` is for an admin reading it out or pasting it into a
   * message; the password comes back either way, because the rotation has
   * already happened and withholding it would strand the account.
   */
  resendCredentials(id: string, sendEmail = true) {
    return api.post<AdminResendCredentialsResult>(
      `/api/admin/users/${id}/resend-credentials`, { send_email: sendEmail },
    );
  },
};

export interface ClientAddressPayload {
  contact_name: string;
  contact_phone: string;
  street_line_1: string;
  street_line_2?: string;
  /** Exactly five digits — Address.postcode is VarChar(5). */
  postcode: string;
  city: string;
  province: string;
  delivery_notes?: string;
}

export interface CreateClientPayload {
  name: string;
  email: string;
  phone?: string;
  phone_country_code?: string;
  preferred_language?: 'es' | 'en';
  client_type: 'retail' | 'business';
  sales_manager_name?: string;
  /** Required when `client_type` is 'business'; `company` is the only
   *  mandatory field inside it. */
  business?: {
    company: string;
    business_type?: string;
    location?: string;
    website?: string;
    registration_no?: string;
    contact_phone?: string;
  };
  address: ClientAddressPayload;
  /**
   * Set when this client also SELLS on Cesto.
   *
   * Additive, not a third client_type: one User can hold both a
   * BusinessProfile (buyer) and a PartnerStoreRole (vendor). The shop is
   * created as a DRAFT — it cannot go live without a delivery zone, which
   * the vendor draws themselves after logging in.
   */
  vendor?: {
    store_name: string;
    tagline_es?: string;
    contact_email?: string;
    contact_phone?: string;
    origin?: string;
  };
  send_credentials?: boolean;
}

export interface CreateClientResult {
  user: AdminUserDetail;
  /** False when the account exists but the welcome email failed to send. */
  email_sent: boolean;
  /** The draft shop, when the client was set up as a vendor too. Null
   *  otherwise, and also null when they already owned one. */
  store: { id: string; name: string } | null;
  message: string;
  /** The email already had an account, which was upgraded (absent from an older API). */
  was_existing?: boolean;
  /** ...and it kept its own login, so nothing was issued or emailed. */
  kept_password?: boolean;
}

export interface AdminUserPatch {
  sales_manager_name?: string | null;
  phone?: string | null;
  phone_country_code?: string;
  preferred_language?: 'es' | 'en';
  is_business?: boolean;
  pricing_mode?: 'retail' | 'b2b';
  /**
   * The buyer's CIF/NIF, and the name it belongs to.
   *
   * A factura cannot be issued without the CIF — it is one of the three
   * blockers — and until now nothing in the API could set it. `null` means
   * the customer has none, and is kept distinct from leaving it unchanged.
   */
  tax_id?: string | null;
  fiscal_name?: string | null;
  /** Under recargo de equivalencia (2026-11-04) — admin only; applies to orders placed from now on. */
  recargo_equivalencia?: boolean;
  /** With recargo_equivalencia: carry it onto their open orders too (not yet delivered or invoiced). */
  apply_to_open_orders?: boolean;
}

// ─── SALES REPS ─────────────────────────────────────────
//
// A rep is a User carrying a SalesRep row, not an Admin — so these endpoints
// grant and revoke a ROLE, they do not create accounts. The account comes
// first, from createClient() or an ordinary sign-up.

export interface AdminSalesRepRow {
  user_id: string;
  code: string | null;
  is_active: boolean;
  granted_at: string;
  notes: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  /** The ACCOUNT's status. A blocked account cannot work whatever the role
   *  says, so a row has to show both. */
  account_status: 'active' | 'blocked';
  member_since: string;
  orders_created: number;
  clients_opened: number;
  granted_by: string | null;
  /** The shops they sell from (2026-10-26); empty = none. Read through repStoresOf. */
  stores?: SalesRepStore[];
  /** The one shop of an API from 2026-10-25, before reps had several. */
  store?: SalesRepStore | null;
  /** Their usual share of the profit, % — what a new statement starts with. */
  commission_pct?: string | null;
  /** Products assigned to them by hand, on top of the shops (2026-10-27). */
  assigned_products?: number;
}

/**
 * A product as the rep profile's Products card and its picker show it
 * (2026-10-27): assigned to a rep by hand, or a candidate to be.
 */
export interface AdminRepProduct {
  id: string;
  name_es: string;
  name_en: string;
  brand: string | null;
  image_url: string | null;
  /** Null = Cesto's own catalogue. */
  store: { id: string; name: string } | null;
  /** Active sizes. */
  sizes: number;
  price_from: string | null;
  price_to: string | null;
  is_active: boolean;
  /** Who it is shown to: a B2B-only one reaches only the rep's business clients. Absent from an older API. */
  audience?: ProductAudience;
  /** Some size has stock. Absent from an older API. */
  in_stock?: boolean;
  /** Why its shop cannot be sold from, or null — then the rep does not see it. */
  shop_unavailable: SalesRepStore['unavailable'];
  /** On the assigned list: since when. */
  assigned_at?: string;
  /** In the picker: already theirs. */
  assigned?: boolean;
}

/** How many of a rep's assigned products come from one shop. Absent from an older API. */
export interface AdminRepProductShop {
  /** Null = Cesto's own catalogue. */
  store: { id: string; name: string } | null;
  count: number;
  /** Of those, how many the rep cannot see now: inactive, or the shop is switched off. */
  hidden: number;
}

/** The rep products page's catalogue filters — the order builder's, plus whether already theirs. */
export type AdminRepProductSearchParams = {
  q?: string;
  /** A shop's id, or HOUSE_STORE_ID for Cesto's own. */
  storeId?: string;
  categoryId?: string;
  subcategoryId?: string;
  brandId?: string;
  originId?: string;
  stock?: 'in' | 'out' | 'low';
  /** Default A–Z. */
  sort?: 'name_asc' | 'name_desc' | 'newest' | 'oldest';
  assigned?: 'true' | 'false';
  page?: number;
  limit?: number;
};

export interface AdminSalesRepProfile extends AdminSalesRepRow {
  window: { from: string | null; to: string | null };
  stats: {
    orders: number;
    /** Built and then cancelled. Work done, money not taken. */
    cancelled: number;
    revenue: string;
    clients_opened: number;
    by_status: Array<{ status: OrderStatus; count: number; total: string }>;
  };
  recent_orders: Array<{
    id: string;
    order_number: string;
    status: OrderStatus;
    total: string;
    created_at: string;
    user: { id: string; name: string } | null;
  }>;
}

export interface AdminGrantSalesRepPayload {
  /** Assign: the existing account to give the role to. */
  user_id?: string;
  /** Create: who they are. Required together when `user_id` is absent. */
  name?: string;
  email?: string;
  phone?: string;
  preferred_language?: 'es' | 'en';
  code?: string | null;
  notes?: string | null;
  /** Only has an effect when a password was actually issued. */
  send_credentials?: boolean;
  /** Their shops: shop ids, and 'cesto' for Cesto's own. Empty for none. */
  store_ids?: string[];
}

export interface AdminSalesRepGrantResult extends AdminSalesRepRow {
  /** False when the account already existed, so they keep their own password.
   *  Optional because an API deployed before this shipped sends neither field. */
  account_created?: boolean;
  /** False when no mail was due, and also when one was due and failed. */
  credentials_sent?: boolean;
}

/**
 * Two facts, because they fail independently.
 *
 * `rotated` is always true on a 200 — the password changed, so their old one
 * is dead whatever happened next. `email_sent` says whether it reached them,
 * and `reason` says why not: no provider configured, or the provider refused.
 * A screen that collapsed these into one would either hide a dead password or
 * claim a delivery it did not make.
 */
export interface AdminResendCredentialsResult {
  rotated: boolean;
  email_sent: boolean;
  reason: string | null;
  /** The username. It is their email, whether or not one was sent. */
  login_email: string;
  /**
   * Returned ONCE, like /api/admin/staff's. Single-use by construction — the
   * account is flagged `password_is_temp`, so it forces the rotate screen —
   * and withholding it would strand an account whose old password this call
   * has already killed.
   */
  temp_password: string;
  message: string;
}

export const adminSalesReps = {
  list(params: { q?: string; status?: 'active' | 'revoked'; page?: number; limit?: number } = {}) {
    return api.get<Paged<AdminSalesRepRow>>('/api/admin/sales-reps', params);
  },
  /** The profile, with figures over an optional date window. */
  get(userId: string, params: { from?: string; to?: string } = {}) {
    return api.get<AdminSalesRepProfile>(`/api/admin/sales-reps/${userId}`, params);
  },
  /**
   * Makes somebody a rep, either way round.
   *
   * Send `user_id` to give the role to an account that already exists, or
   * `name` + `email` to create the account, grant the role and email the
   * credentials in one call. An email that turns out to already have an
   * account resolves to the first case server-side — nothing is duplicated and
   * nobody's existing password is reset, which the response reports back as
   * `account_created: false`.
   */
  grant(payload: AdminGrantSalesRepPayload) {
    return api.post<AdminSalesRepGrantResult>('/api/admin/sales-reps', payload);
  },
  /** `is_active: false` revokes without destroying their history. */
  update(userId: string, payload: { code?: string | null; notes?: string | null; is_active?: boolean; store_ids?: string[]; commission_pct?: number | null }) {
    return api.put<AdminSalesRepRow>(`/api/admin/sales-reps/${userId}`, payload);
  },
  /**
   * Products assigned to them by hand, newest first; `sellable` counts those
   * they can sell now, `by_shop` all of them by shop (whatever the filter).
   */
  products(userId: string, params: { q?: string; storeId?: string; page?: number; limit?: number } = {}) {
    return api.get<Paged<AdminRepProduct> & { sellable: number; by_shop?: AdminRepProductShop[] }>(`/api/admin/sales-reps/${userId}/products`, params);
  },
  /** The picker: active products of any shop that can be sold from, each saying if already theirs. */
  searchProducts(userId: string, params: AdminRepProductSearchParams = {}) {
    return api.get<Paged<AdminRepProduct>>(`/api/admin/sales-reps/${userId}/products/search`, params);
  },
  /** Assigns these; ones already theirs are left as they are. */
  assignProducts(userId: string, productIds: string[]) {
    return api.post<{ added: number; total: number }>(`/api/admin/sales-reps/${userId}/products`, { product_ids: productIds });
  },
  unassignProducts(userId: string, productIds: string[]) {
    return api.post<{ removed: number; total: number }>(`/api/admin/sales-reps/${userId}/products/remove`, { product_ids: productIds });
  },
  /** Their balance, its history, and their orders on the way to an earning (API lib/repEarnings). */
  earnings(userId: string) {
    return api.get<AdminRepEarnings>(`/api/admin/sales-reps/${userId}/earnings`);
  },
  /** One line of their history, opened — with the buying total. */
  earningEntry(userId: string, entryId: string) {
    return api.get<RepEntryDetail<AdminRepOrderEarning>>(`/api/admin/sales-reps/${userId}/earnings/entries/${entryId}`);
  },
  /** Money paid to them. `paid_on` defaults to today. */
  recordPayout(userId: string, body: { amount: number; paid_on?: string; note?: string | null }) {
    return api.post<{ id: string }>(`/api/admin/sales-reps/${userId}/earnings/payouts`, body);
  },
  /** A payment recorded by mistake, undone by an entry that gives it back. */
  voidPayout(userId: string, entryId: string, reason?: string | null) {
    return api.post<{ voided: true }>(`/api/admin/sales-reps/${userId}/earnings/payouts/${entryId}/void`, { reason: reason ?? null });
  },
  /** A bonus (+) or a deduction (−); the note is shown to the rep. */
  addAdjustment(userId: string, body: { amount: number; note: string }) {
    return api.post<{ id: string }>(`/api/admin/sales-reps/${userId}/earnings/adjustments`, body);
  },
  /**
   * Issues a NEW temporary password and emails it.
   *
   * Not a re-send of the original — that one is a hash and gone. Their current
   * password stops working, every session is dropped, and because a rep is one
   * account, the storefront password goes with it. Worth a confirmation.
   *
   * 502 means the rotation committed and the mail did not, which is the
   * failure the caller most needs to read out loud.
   */
  /**
   * `sendEmail: false` issues the password without mailing it, for handing
   * over directly. Either way a NEW password is issued and the old one dies —
   * there is no way to read back the one they have, only to replace it.
   */
  resendCredentials(userId: string, sendEmail = true) {
    return api.post<AdminResendCredentialsResult>(
      `/api/admin/sales-reps/${userId}/resend-credentials`, { send_email: sendEmail },
    );
  },
};

// ─── INVOICING ──────────────────────────────────────────

export type InvoiceStatus = 'draft' | 'issued';
/**
 * `albaran` is not a fiscal document and the page says so. It is what gets
 * issued until the seller's CIF/NIF is configured and every product's VAT
 * rate has been reviewed; after that the same flow produces `invoice`.
 */
export type InvoiceKind = 'albaran' | 'invoice' | 'credit_note';

export interface InvoiceLine {
  description: string;
  quantity: number;
  /** VAT-INCLUSIVE unit price, as a 2-decimal string. */
  unit_price: string;
  /**
   * Flat euros taken off this line before `gross`. Absent when none was
   * given, and absent on every invoice issued before discounts existed —
   * invoice bodies are snapshots and are never rewritten.
   */
  discount?: string;
  /** VAT-inclusive line total, already NET of `discount`. */
  gross: string;
  rate_pct: number;
  /**
   * `default` means nobody confirmed this product's rate. `delivery` is the
   * delivery line, taxed by a fixed rule; documents issued before it existed
   * call that line `default`.
   */
  vat_source: 'product' | 'default' | 'delivery';
  product_id: string | null;
  /**
   * One unit WITHOUT IVA (since 2026-11-04): the line's anchor. A rate
   * changed on a document re-adds IVA to this, so the price and the total
   * follow the rate. Absent on older documents — read it out of `unit_price`
   * with removeVatCents.
   */
  unit_base?: string;
  /**
   * Which line this is: the order item's id, `delivery` for the fee, or
   * `manual:<uuid>` for one typed on the document. What a hidden line is
   * remembered by. Absent on documents drafted before 2026-11-04.
   */
  key?: string;
  /** The product's code (its size's sku) for the CÓDIGO column; null or absent when none. */
  code?: string | null;
}

/**
 * A line left off the document on purpose (2026-11-04): never printed, never
 * in the totals, and the order is not changed by it. `at` is where it sat.
 */
export interface HiddenInvoiceLine extends InvoiceLine {
  at: number;
}

/** Any subset of a party snapshot. Omitted fields are left as they were. */
export interface InvoicePartyPatch {
  name?: string;
  tax_id?: string | null;
  address?: string;
  postcode?: string;
  city?: string;
  province?: string;
  country?: string;
  email?: string;
  phone?: string;
}

export interface InvoiceTotals {
  by_rate: Array<{
    rate_pct: number; base: string; vat: string; gross: string;
    /** Recargo de equivalencia for this rate, when the document charges it (2026-11-04). */
    recargo_pct?: number;
    recargo?: string;
  }>;
  base: string;
  vat: string;
  /** Base + IVA. */
  gross: string;
  /** Recargo de equivalencia on the whole document; absent when none. */
  recargo?: string;
  /** Base + IVA + recargo; absent on documents from before 2026-11-04 (then `gross`). */
  total?: string;
  /** Everything taken off the lines, summed. Optional for the same reason
   *  `InvoiceLine.discount` is: older snapshots do not carry it. */
  discount_total?: string;
}

export interface InvoiceParty {
  [key: string]: unknown;
  name?: string;
  legal_name?: string;
  tax_id?: string | null;
  address?: string | null;
  postcode?: string | null;
  city?: string | null;
  province?: string | null;
  country?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface Invoice {
  id: string;
  kind: InvoiceKind;
  status: InvoiceStatus;
  /** True once a draft's own figures were edited, after which it stops
   *  re-syncing from its order. Always false on an issued document. */
  manually_edited?: boolean;
  /** The document charges recargo de equivalencia (copied from its order, 2026-11-04). */
  recargo_equivalencia?: boolean;
  recargo_total?: string;
  series: string | null;
  year: number | null;
  number: number | null;
  invoice_number: string | null;
  issue_date: string | null;
  order_id: string;
  user_id: string;
  seller_snapshot: InvoiceParty;
  buyer_snapshot: InvoiceParty;
  /** Exactly what the document prints — hidden lines are never in here. */
  lines: InvoiceLine[];
  /**
   * The lines left off it (admin only; a rep's copy never carries them, and
   * an API from before 2026-11-04 sends none).
   */
  hidden_lines?: HiddenInvoiceLine[];
  totals: InvoiceTotals;
  taxable_base: string;
  vat_total: string;
  total: string;
  currency: string;
  payment_terms: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  user?: { id: string; name: string; tax_id?: string | null };
  order?: { id: string; order_number: string; status?: string };
  /** A split purchase's document: the purchase it covers (for the PEDIDO column). */
  parent_order?: { id: string; order_number: string } | null;
}

export type InvoiceBlockerCode =
  | 'seller_not_configured'
  | 'unreviewed_vat'
  | 'buyer_tax_id_missing'
  | 'order_cancelled'
  | 'order_deleted'
  | 'order_draft'
  | 'already_invoiced';

export interface InvoiceBlocker {
  code: InvoiceBlockerCode;
  message: string;
  /** True when it only stops a full factura, not an albarán. */
  albaran_ok: boolean;
  /**
   * Missing data, and the draft is where it gets typed in — so this one does
   * not refuse anything. The screen says "fill it in here" rather than
   * sending somebody to Ajustes or to each product. See `document_blockers`
   * for what is still actually stopping the factura.
   */
  fix_on_document: boolean;
  product_ids?: string[];
}

export interface InvoiceEnvelope {
  invoice: Invoice;
  blockers: InvoiceBlocker[];
  /**
   * What the DOCUMENT still needs before it can go out as a factura, read
   * from the document rather than from the records behind it. Empty means
   * issuable. This is what the Issue button gates on; `blockers` is the fuller
   * picture and includes things that are worth saying but no longer refuse.
   */
  document_blockers: InvoiceBlocker[];
  /** What this document can be right now. null = cannot be issued at all. */
  kind: InvoiceKind | null;
  /**
   * Indexes of lines that no longer match the order, once the draft has been
   * edited by hand. Empty while it still tracks the order, which is normal.
   * Computed per request — the order can move underneath a detached draft.
   */
  divergence?: number[];
}

export interface InvoicingSettings {
  legal_name: string;
  tax_id: string;
  address: string;
  postcode: string;
  city: string;
  province: string;
  country: string;
  email: string;
  phone: string;
  series_invoice: string;
  series_albaran: string;
  payment_terms: string;
}

// ─── Document archive ─────────────────────────────

/** The archive's tabs. A credit note is filed under `invoice`. */
export type ArchiveKind = 'invoice' | 'albaran' | 'bill';

export type ArchiveFilters = {
  kind: ArchiveKind;
  /** Madrid calendar days, YYYY-MM-DD, inclusive. */
  from?: string;
  to?: string;
  q?: string;
};

/** One row of the archive, the same shape in all three tabs. */
export interface ArchiveRow {
  id: string;
  kind: InvoiceKind | 'bill';
  /** The document's number; a bill has none, so its order's. */
  number: string;
  /** Issued on, or for a bill the order's date. */
  date: string;
  total: string;
  client: { id: string; name: string; tax_id: string | null } | null;
  order: { id: string; order_number: string; status: OrderStatus | null } | null;
}

export interface ArchivePerson { name: string; code: string | null; is_rep: boolean }
export interface ArchiveClient {
  id: string; name: string; email: string | null; phone: string | null; tax_id: string | null;
}

/** A PDF to send: what shared/invoice draws. */
export interface ArchivePdfFile { name: string; bytes: Uint8Array }

export interface ArchivedInvoice {
  invoice: Invoice;
  issued_by: ArchivePerson | null;
  drafted_by: ArchivePerson | null;
  /** Its saved file, or null until one has been kept. */
  pdf: { saved_at: string; sha256: string; size_bytes: number; saved_by: ArchivePerson | null } | null;
  client: ArchiveClient;
  order: {
    id: string; order_number: string; status: OrderStatus; deleted: boolean; is_purchase: boolean;
  } | null;
}

export interface ArchivedBill {
  bill: OrderBill;
  client: ArchiveClient;
  address: Record<string, unknown> | null;
  order: {
    id: string; order_number: string; status: OrderStatus; payment_method: string;
    created_at: string; is_purchase: boolean;
  };
}

export const adminDocuments = {
  list(params: ArchiveFilters & { sort?: 'asc' | 'desc'; page?: number; limit?: number }) {
    return api.get<Paged<ArchiveRow>>('/api/admin/documents', params);
  },
  /** One page of a range with everything its PDFs need, oldest first. */
  exportPage(params: ArchiveFilters & { page: number; limit: number }) {
    return api.get<Paged<{ id: string; invoice?: Invoice; pdf_saved?: boolean; bill?: OrderBill }>>('/api/admin/documents/export', params);
  },
  issued(id: string) {
    return api.get<ArchivedInvoice>(`/api/admin/documents/issued/${id}`);
  },
  bill(id: string) {
    return api.get<ArchivedBill>(`/api/admin/documents/bill/${id}`);
  },
  /** The saved file. A 404 means none has been kept yet. */
  pdfBytes(id: string) {
    return api.getBytes(`/api/admin/documents/issued/${id}/pdf`, { timeoutMs: 60_000 });
  },
  /** Keep this document's PDF. Answers `already` if one is kept: that one stays. */
  savePdf(id: string, file: ArchivePdfFile) {
    const form = new FormData();
    form.append('file', new Blob([file.bytes as BlobPart], { type: 'application/pdf' }), file.name);
    return api.post<{ status: 'saved' | 'already'; saved_at: string; sha256: string; size_bytes: number }>(
      `/api/admin/documents/issued/${id}/pdf`, form, { multipart: true, timeoutMs: 60_000 },
    );
  },
};

export const adminInvoices = {
  /** Create the draft, or return the one already there. Idempotent. */
  /** `kind` omitted = the best document the blockers allow. */
  createForOrder(orderId: string, kind?: 'albaran' | 'invoice') {
    return api.post<InvoiceEnvelope>(`/api/admin/orders/${orderId}/invoice`, kind ? { kind } : {});
  },
  list(params: {
    status?: InvoiceStatus; kind?: InvoiceKind; user_id?: string; q?: string;
    page?: number; limit?: number;
  } = {}) {
    return api.get<Paged<Invoice>>('/api/admin/invoices', params);
  },
  get(id: string) { return api.get<InvoiceEnvelope>(`/api/admin/invoices/${id}`); },
  /**
   * Drafts only; an issued document is immutable and the database enforces it.
   *
   * Everything on the document except its number and its issue date, both of
   * which the server owns: a gap-free series and a date nobody can backdate
   * are the two things that make it a legal document rather than a PDF.
   *
   * Sending `lines` DETACHES the draft from its order — it stops re-syncing
   * on read, and the response's `divergence` then names the lines that no
   * longer match what was ordered.
   */
  update(id: string, payload: {
    notes?: string | null;
    payment_terms?: string | null;
    buyer?: InvoicePartyPatch;
    seller?: InvoicePartyPatch;
    lines?: Array<{
      description: string;
      quantity: number;
      /** 2-decimal string, VAT-inclusive. Ignored when `unit_base` is sent. */
      unit_price: string;
      /** One unit without IVA; the server adds IVA at `rate_pct` (2026-11-04). */
      unit_base?: string;
      discount?: string;
      rate_pct: number;
      product_id?: string | null;
      /** CÓDIGO for this document only; absent keeps it, empty clears it (2026-11-04). */
      code?: string | null;
      /** The line's key as read; a new line gets one from the server. */
      key?: string;
    }>;
    /**
     * Every key to leave off the document — the whole set, so showing a line
     * again is sending it without that key. Does NOT detach the draft: the
     * order is not changed and the draft keeps following it.
     */
    hidden?: string[];
  }) {
    return api.put<Invoice>(`/api/admin/invoices/${id}`, payload);
  },
  /** One-way. Allocates the number and freezes the document. */
  issue(id: string) {
    return api.post<{ invoice: Invoice; kind: InvoiceKind }>(`/api/admin/invoices/${id}/issue`, {});
  },
  remove(id: string) {
    return api.delete<{ message: string }>(`/api/admin/invoices/${id}`);
  },
};

export const adminInvoicingSettings = {
  get() { return api.get<InvoicingSettings>('/api/admin/invoicing-settings'); },
  update(payload: InvoicingSettings) {
    return api.put<InvoicingSettings>('/api/admin/invoicing-settings', payload);
  },
};

// ─── STORE SETTINGS ────────────────────────────────────
// Singleton config surface used by the admin Settings page. Every field
// is persisted into one JSON blob server-side.
export interface StoreSettings {
  storeName: string;
  logoUrl: string;
  contactEmail: string;
  contactPhone: string;
  address: string;
  /** Minimum order amount in EUR. */
  minOrderValue: number;
  /** Flat delivery fee in EUR, charged on every order. Platform-wide: this
   *  replaced the per-zone fee that DeliveryZone used to carry, so the price
   *  no longer depends on which zone happened to list the customer's
   *  postcode. Free-delivery thresholds were removed on 2026-09-25 — there is
   *  no subtotal at which this stops being charged. */
  deliveryFee: number;
  /**
   * `flat` charges `deliveryFee` on every order. `distance` prices from
   * `deliveryBands` by how far the
   * delivery address is from the origin below, and silently falls back to the
   * flat pair whenever it cannot — no origin, empty ladder, or an address
   * that has never been geocoded.
   */
  deliveryPricingMode: DeliveryPricingMode;
  /** Free text the admin typed; `POST /api/admin/settings/geocode` turns it
   *  into the coordinates below. Kept so the page can show what was located. */
  deliveryOriginAddress: string;
  deliveryOriginLat: number | null;
  deliveryOriginLng: number | null;
  /** The ladder, ascending, with the open-ended band last. The server
   *  re-sorts on save, so what comes back is what pricing reads. */
  deliveryBands: DeliveryBand[];
  /** Comma-separated recipients for admin notification emails. */
  notificationEmails: string;
  privacyPolicy: string;
  termsConditions: string;
  maintenanceMode: boolean;
}

export type DeliveryPricingMode = 'flat' | 'distance';

/**
 * One rung of the distance ladder.
 *
 * `upToKm: null` marks the open-ended final band — everything past the rung
 * below it. Exactly one band carries it and it always sorts last, so no
 * distance can fall off the end of the ladder.
 *
 * Free-delivery thresholds were removed on 2026-09-25, so a band is a
 * distance and a fee. Delivery is charged on every order.
 */
export interface DeliveryBand {
  upToKm: number | null;
  fee: number;
}

/** Coordinates resolved from a written address, server-side. */
export interface GeocodeResult {
  lat: number;
  lng: number;
  /** Google `location_type` — ROOFTOP down to APPROXIMATE. */
  precision: string;
  /** Google's normalised rendering of what it matched. */
  formatted: string;
}

export const adminSettings = {
  get(): Promise<StoreSettings> {
    return api.get<StoreSettings>('/api/admin/settings');
  },
  update(payload: StoreSettings): Promise<StoreSettings> {
    return api.put<StoreSettings>('/api/admin/settings', payload);
  },
  /**
   * Locate the delivery origin. Returns coordinates only — saving them is
   * the ordinary `update` above, so an admin can check what was found before
   * it prices anything.
   */
  geocode(address: string): Promise<GeocodeResult> {
    return api.post<GeocodeResult>('/api/admin/settings/geocode', { address });
  },
};

/**
 * Public (no-auth) projection of the admin StoreSettings blob. Only the
 * fields a shopper actually consumes — the notificationEmails recipient
 * list is intentionally NOT surfaced here.
 */
export interface PublicStoreSettings {
  storeName: string;
  logoUrl: string;
  contactEmail: string;
  contactPhone: string;
  address: string;
  minOrderValue: number;
  privacyPolicy: string;
  termsConditions: string;
  maintenanceMode: boolean;
  /**
   * Enough of the delivery pricing to quote a fee in the cart, before an
   * address has been picked. The dispatch origin is deliberately absent —
   * a shopper needs the ladder, not where the vans leave from.
   *
   * For a specific address the authoritative number is still
   * `POST /api/orders/quote`; this is for display ahead of one being chosen.
   */
  deliveryPricingMode: DeliveryPricingMode;
  deliveryFee: number;
  deliveryBands: DeliveryBand[];
}

export const publicSettings = {
  get(): Promise<PublicStoreSettings> {
    return api.get<PublicStoreSettings>('/api/settings');
  },
};
