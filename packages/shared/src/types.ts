import type { VatCategory } from './tax';

// ─── ENUMS ──────────────────────────────────────────────
// Mirror Prisma enums exactly

export type UserStatus = 'active' | 'blocked';
export type Language = 'es' | 'en';
export type OrderStatus = 'pending' | 'confirmed' | 'preparing' | 'on_the_way' | 'delivered' | 'cancelled' | 'partially_completed' | 'draft';
export type PaymentMethod = 'cod' | 'card' | 'bizum';
export type VehicleType = 'moto' | 'bicicleta' | 'coche';

// ─── USER ───────────────────────────────────────────────

export interface PartnerRoleSummary {
  store_id: string;
  store_slug: string;
  store_name: string;
  role: 'owner' | 'manager';
}

/** Which price column the storefront renders and checkout charges. */
export type PricingMode = 'retail' | 'b2b';

/** Trading details for an approved B2B business customer, snapshotted from
 *  their application at approval time. */
export interface BusinessProfile {
  company: string;
  business_type: string | null;
  location: string | null;
  website: string | null;
  registration_no: string | null;
  contact_phone: string | null;
  approved_at: string;
}

/**
 * What a partner submitted on the /partner-deals form, preserved through
 * approval. Read-only to the partner — an admin verified these details, so
 * changing them is a support conversation.
 */
export interface PartnerProfile {
  company: string;
  business_type?: string | null;
  location?: string | null;
  website?: string | null;
  registration_no?: string | null;
  contact_phone?: string | null;
  approved_at: string;
  /** True when an existing Cesto store was adopted rather than one created
   *  for this application. */
  linked_existing: boolean;
  /** The store they actually manage. Null if it was later unlinked. */
  linked_store?: { id: string; slug: string; name: string } | null;
}

export interface User {
  id: string;
  name: string;
  phone: string | null;
  phone_country_code: string | null;
  email: string | null;
  avatar_url: string | null;
  preferred_language: Language;
  fcm_token: string | null;
  status: UserStatus;
  /** True while a partner-approval temp password hasn't been rotated. */
  password_is_temp?: boolean;
  /** Empty for regular customers. One entry per store the user manages. */
  partner_roles?: PartnerRoleSummary[];
  /**
   * An ACTIVE sales rep. The API filters on is_active, so a revoked rep reads
   * as false rather than as "rep, but inactive" — one fact for callers to get
   * right instead of two.
   *
   * Optional, like the fields around it: the web app and the API deploy
   * independently, and an app running against an older API must degrade to
   * "not a rep" rather than crash.
   */
  is_sales_rep?: boolean;
  /** Their staff number, when they have one. */
  sales_rep_code?: string | null;
  /** Approved B2B business customer. Gates the price toggle and wholesale
   *  price visibility. Optional so a frontend deployed ahead of the API
   *  degrades to "regular customer" rather than crashing. */
  is_business?: boolean;
  /** Which price view is active. Server-authoritative — order totals are
   *  computed from it, so it isn't client state. */
  pricing_mode?: PricingMode;
  /**
   * CIF/NIF, and the name it belongs to.
   *
   * This is the tax identity a factura has to carry, and the one
   * `buyer_tax_id_missing` reads. Distinct from
   * BusinessProfile.registration_no, which is a company registry number —
   * screens that want the CIF should prefer this and fall back to that only
   * for accounts approved before there was anywhere to put it.
   */
  tax_id?: string | null;
  fiscal_name?: string | null;
  /**
   * Under RECARGO DE EQUIVALENCIA (2026-11-04): a retailer charged a surcharge
   * on top of IVA on each order. Set by an admin; absent from an older API.
   */
  recargo_equivalencia?: boolean;
  /** Trading details captured at approval. Present only for businesses. */
  business_profile?: BusinessProfile | null;
  /** The application this partner submitted, kept after approval. Present
   *  only for approved partner_store applicants. Distinct from
   *  business_profile: that marks a wholesale BUYER and drives b2b pricing;
   *  this marks a seller and drives nothing. */
  partner_profile?: PartnerProfile | null;
  created_at: string;
  updated_at: string;
  addresses?: Address[];
  orders?: Order[];
}

// ─── ADDRESS ────────────────────────────────────────────

export interface Address {
  id: string;
  user_id: string;
  contact_name: string;
  contact_phone: string;
  street_line_1: string;
  street_line_2: string | null;
  postcode: string;
  city: string;
  province: string;
  delivery_notes: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

// ─── CATEGORY ───────────────────────────────────────────

export type CategoryApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface Category {
  id: string;
  name_es: string;
  name_en: string;
  icon_url: string | null;
  /** Card background tint for the Shop by Origin-style home tile. */
  bg_color: string | null;
  /** Card accent — used for the silhouette/initial fallback and small chrome. */
  accent_color: string | null;
  sort_order: number;
  is_active: boolean;
  /** 'admin' = created in the Cesto panel. 'partner' = submitted by a vendor. */
  source: string;
  approval_status: CategoryApprovalStatus;
  submitted_by_store_id: string | null;
  submitted_by_user_id: string | null;
  rejection_reason: string | null;
  reviewed_at: string | null;
  reviewed_by_admin_id: string | null;
  created_at: string;
  updated_at: string;
  subcategories?: SubCategory[];
  products?: Product[];
  _count?: { subcategories: number; products: number };
  /** Number of bulk-import rows queued under this category name. Set by the
      admin list/create endpoints; undefined on customer-facing payloads. */
  pending_products_count?: number;
  /** Included on the admin partner-submissions queue only. */
  submitted_by_store?: { id: string; name: string; slug: string } | null;
}

/** A partner's own category submission — shape returned by
 *  GET /api/partner/taxonomy/categories/mine. Trimmed vs the full admin
 *  Category shape since a partner never sees another store's rows. */
export interface PartnerCategorySubmission {
  id: string;
  name_es: string;
  name_en: string;
  icon_url: string | null;
  approval_status: CategoryApprovalStatus;
  rejection_reason: string | null;
  created_at: string;
  reviewed_at: string | null;
}

// ─── PENDING CATEGORY ──────────────────────────────────
// A category name surfaced by the Excel import that doesn't match any
// existing Category yet. Admin promotes it to a real Category from the
// Categories page; matching pending rows clear automatically on create.

export interface PendingCategory {
  id: string;
  name: string;
  source_row_count: number;
  first_seen_at: string;
  last_seen_at: string;
}

// ─── PENDING PRODUCT ───────────────────────────────────
// A full product payload parked during a bulk import because its category
// didn't exist yet. Surfaced on the Categories page once the matching
// Category is created, so the admin can review and publish.

export interface PendingProductVariant {
  name_es: string;
  name_en: string;
  price: number;
  compare_at_price: number | null;
  /**
   * Euros off one unit agreed with the signed-in customer (2026-10-25). When
   * set, `price` already has it taken off and `compare_at_price` is the
   * price it came off — what the API sends; nothing here subtracts it again.
   */
  customer_discount?: number | string | null;
  stock_quantity: number;
  low_stock_threshold: number;
  sku: string | null;
  is_default: boolean;
  is_active: boolean;
}

export interface PendingProduct {
  id: string;
  category_name_key: string;
  category_name_raw: string;
  subcategory_name_raw: string | null;
  product_key: string;
  name_es: string;
  name_en: string;
  description_es: string | null;
  description_en: string | null;
  brand: string | null;
  origin: string | null;
  is_active: boolean;
  is_featured: boolean;
  variants: PendingProductVariant[];
  image_urls: string[];
  source_row_number: number;
  created_at: string;
  updated_at: string;
}

// ─── SUBCATEGORY ────────────────────────────────────────

export interface SubCategory {
  id: string;
  category_id: string;
  name_es: string;
  name_en: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  /** Optional — populated when the API include-response asks for nested types.
   *  See ProductType in services/productTypes.ts. */
  product_types?: Array<{
    id: string; subcategory_id: string; name_es: string; name_en: string;
    sort_order: number; is_active: boolean;
  }>;
  _count?: { product_types: number };
}

// ─── PRODUCT ────────────────────────────────────────────

/**
 * Who a product is shown to in the shop and the app (2026-10-25): `all` —
 * both kinds of customer, each at their own price — `b2c` (everyone but
 * business accounts, visitors included) or `b2b` (business accounts only).
 */
/**
 * One of the shops a sales rep sells from (API lib/repStore; one shop since
 * 2026-10-25, several since 2026-10-26): a partner shop, or Cesto's own
 * catalogue (`id: 'cesto'`). A rep with none they can sell from cannot
 * build orders.
 */
export interface SalesRepStore {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  /** False when the shop is switched off, suspended or being deleted. */
  sellable: boolean;
  unavailable: 'inactive' | 'suspended' | 'deleting' | 'deleted' | null;
}
/** The id that stands for Cesto's own catalogue, as in product filters. */
export const HOUSE_STORE_ID = 'cesto';

// ─── A sales rep's earnings, order by order (2026-10-28; API lib/repEarnings) ───
//
// net profit = products after discounts (IVA in, no delivery fee) − buying
// prices − the order's expenses; the rep earns their % of it, 0 at a loss.
// Owed once the order is delivered AND an admin approves it. Money as strings
// with two decimals, as the API sends them.

/**
 * draft — a parked basket, not a sale; expected — placed, not delivered;
 * awaiting_approval — delivered, not approved yet; approved — owed (until
 * paid); not_earned — cancelled or deleted before approval; reversed —
 * approved, then cancelled or deleted, and taken back.
 */
export type RepEarningStatus = 'draft' | 'expected' | 'awaiting_approval' | 'approved' | 'not_earned' | 'reversed';

export interface RepEarningExpense { label: string; amount: string }

/** What a rep sees on their order — never a buying price. As approved, once it is. */
/**
 * A profit an admin typed in by hand on an order (2026-10-28): the gross
 * (the order's expenses still come off it) or the net (nothing comes off).
 */
export type RepProfitBasis = 'gross' | 'net';

export interface RepOrderEarning {
  status: RepEarningStatus;
  sales: string;
  /** Products less their buying cost — before the order's expenses. Absent from an API before 2026-10-28. */
  gross_profit?: string;
  expenses: RepEarningExpense[];
  expenses_total: string;
  net_profit: string;
  /** Set by the office by hand, and which: never who. Null or absent = worked out. */
  profit_basis?: RepProfitBasis | null;
  /** Null until they have a percentage. */
  percentage: string | null;
  earning: string;
  approved_at: string | null;
  reversed_at: string | null;
}

/** Why an order cannot be approved now. */
export type RepEarningBlocker = 'not_rep_order' | 'deleted' | 'cancelled' | 'reversed' | 'not_delivered' | 'no_percentage';

/** What an admin sees on an order a rep built: the live figures and, once approved, the approved ones. */
export interface AdminRepOrderEarning {
  status: RepEarningStatus;
  rep: { user_id: string; name: string };
  sales: string;
  buying: string;
  /** Lines whose buying price is still 0 — likely not entered yet. */
  lines_without_cost: number;
  /** Products less their buying cost — before the order's expenses — or as set by hand. */
  gross_profit?: string;
  expenses: { id: string; label: string; amount: string }[];
  expenses_total: string;
  net_profit: string;
  /** Which profit was set by hand, if one was. Absent from an older API. */
  profit_basis?: RepProfitBasis | null;
  /** The profit typed in by hand, and who did it and when — recorded against the order. */
  profit_set?: { basis: RepProfitBasis; amount: string; at: string | null; by: string | null } | null;
  percentage: string | null;
  /** Where the % comes from: the order's own, the rep's usual, or none yet. */
  pct_source: 'order' | 'rep' | 'none';
  order_pct: string | null;
  rep_pct: string | null;
  earning: string;
  approved: {
    at: string;
    sales: string;
    buying: string;
    gross_profit?: string;
    expenses: RepEarningExpense[];
    expenses_total: string;
    net_profit: string;
    /** Which profit was set by hand when it was approved. */
    profit_basis?: RepProfitBasis | null;
    percentage: string | null;
    earning: string;
  } | null;
  /** Approved, and a buying price, an expense, the % or a profit set by hand changed since. */
  changed_since_approval: boolean;
  reversed_at: string | null;
  can_approve: boolean;
  approve_blocker: RepEarningBlocker | null;
}

/** What the admin sends: the order's own % (null = the rep's usual) and the whole list of expenses. */
export interface RepOrderEarningInput {
  commission_pct: number | null;
  expenses: { label: string; amount: number }[];
  /** A profit set by hand; null = worked out again; left out = as it was. */
  profit?: { basis: RepProfitBasis; amount: number } | null;
}

export type RepLedgerKind =
  | 'order_earning' | 'order_adjustment' | 'order_reversal' | 'order_not_earned'
  | 'adjustment' | 'payout' | 'payout_void' | 'legacy_statement';

/** One line of a rep's balance history, with the balance after it. */
export interface RepLedgerEntry {
  id: string;
  kind: RepLedgerKind;
  /** + owed to the rep, − paid or taken back. */
  amount: string;
  /** order_not_earned: what the order was expected to earn. */
  reference_amount: string | null;
  balance: string;
  /** `id` is null once the order can no longer be opened (deleted). */
  order: { id: string | null; order_number: string } | null;
  /** A payment's day, or the day it happened. */
  occurred_on: string;
  created_at: string;
  note: string | null;
  /** A payment undone since. */
  voided: boolean;
  voids_entry_id: string | null;
}

export interface RepEarningsTotals {
  /** Owed to them now; negative = paid ahead. */
  owed: string;
  earned: string;
  paid: string;
  /** Earned this calendar month (Madrid). */
  this_month: string;
  awaiting_approval: string;
  awaiting_count: number;
  expected: string;
  expected_count: number;
}

/** An order still on its way to an earning. */
export interface RepPendingOrder {
  id: string;
  order_number: string;
  client_name: string;
  status: RepEarningStatus;
  delivered_at: string | null;
  created_at: string;
  sales: string;
  earning: string;
}

export interface AdminRepPendingOrder extends RepPendingOrder {
  order_status: string;
  /** Approved orders whose figures changed: what was approved. */
  approved_earning: string | null;
  lines_without_cost: number;
}

/** A period statement a carried-over history line was (before 2026-10-28). */
export interface RepStatementBreakdown {
  period_from: string;
  period_to: string;
  /** The profit an admin entered — before expenses. */
  gross_profit: string;
  expenses: RepEarningExpense[];
  expenses_total: string;
  net_profit: string;
  percentage: string | null;
  earning: string;
  notes: string | null;
}

/** One line of the history, opened: the order or the statement it came from. */
export interface RepEntryDetail<E = RepOrderEarning> {
  entry: RepLedgerEntry;
  order: {
    /** Null once the order is deleted. */
    id: string | null;
    order_number: string;
    client_name: string;
    order_status: string;
    deleted: boolean;
    delivered_at: string | null;
    earning: E;
  } | null;
  statement: RepStatementBreakdown | null;
}

/** GET /api/sales/earnings */
export interface RepEarnings {
  commission_pct: string | null;
  totals: RepEarningsTotals;
  /**
   * This calendar month (Madrid): the expenses and net profit of the orders
   * the sales card counts — placed this month, drafts and cancelled left out.
   * Absent from an API before it was added.
   */
  month?: { orders: number; expenses: string; net_profit: string };
  pending: RepPendingOrder[];
  history: RepLedgerEntry[];
}

/** GET /api/admin/sales-reps/:userId/earnings */
export interface AdminRepEarnings {
  commission_pct: string | null;
  totals: RepEarningsTotals;
  to_approve: AdminRepPendingOrder[];
  changed: AdminRepPendingOrder[];
  expected: AdminRepPendingOrder[];
  history: RepLedgerEntry[];
}
/** The API's refusals when a rep has no shop, or picks from another. */
export const REP_NO_STORE = 'rep_no_store';
export const REP_OUTSIDE_STORE = 'rep_outside_store';
/** Quick-add by a rep with several shops, without saying which. */
export const REP_PICK_STORE = 'rep_pick_store';
/** A rep issuing credentials to a client who already logs in with their own. */
export const CLIENT_HAS_OWN_LOGIN = 'client_has_own_login';
/** A rep opening a client whose email is the office's or another rep's client. */
export const CLIENT_BELONGS_ELSEWHERE = 'client_belongs_elsewhere';

/**
 * A rep's shops from a payload of either age: `stores` since 2026-10-26, the
 * one `store` before. Undefined when the API sent neither — one from before
 * shops existed, which must not be read as "none".
 */
export function repStoresOf(p: { stores?: SalesRepStore[]; store?: SalesRepStore | null } | null | undefined): SalesRepStore[] | undefined {
  if (!p) return undefined;
  if (Array.isArray(p.stores)) return p.stores;
  if ('store' in p) return p.store ? [p.store] : [];
  return undefined;
}

/**
 * The Bill (API lib/bill, 2026-10-27): a plain priced list of an order for the
 * customer, beside the albarán and the factura. It carries the customer's
 * name, the lines and the totals — nothing else about anyone, and nothing of
 * Cesto's (no company name since 2026-11-04). Made from the order on demand;
 * not numbered, not a fiscal document.
 */
export interface OrderBill {
  customer: string;
  /** The order's, or the whole purchase's for a split one. */
  order_number: string;
  date: string;
  lines: Array<{
    name_es: string;
    name_en: string | null;
    variant_es: string | null;
    variant_en: string | null;
    quantity: number;
    /** One unit, net of the customer's discount: quantity × this is the line. */
    unit_price: string;
    line_total: string;
  }>;
  subtotal: string;
  delivery_fee: string;
  /** No fee set yet: print "to be confirmed", not "free". */
  delivery_pending: boolean;
  /** Recargo de equivalencia charged; '0.00' (or absent, from an older API) when none. */
  recargo?: string;
  total: string;
}

/** A refusal's code, read off an API error. */
export function apiErrorCode(err: unknown): string | null {
  const code = (err as { data?: { code?: unknown } } | null)?.data?.code;
  return typeof code === 'string' ? code : null;
}

export type ProductAudience = 'all' | 'b2c' | 'b2b';
export const PRODUCT_AUDIENCES: ProductAudience[] = ['all', 'b2c', 'b2b'];

/**
 * B2B only needs a B2B price on every size, or a business would pay the shop
 * price (API lib/audience). The API refuses with 422 and this code, naming
 * the sizes still without one.
 */
export const B2B_PRICE_REQUIRED = 'b2b_price_required';
export interface UnpricedSize { id: string | null; name_es: string; name_en: string; price: number }

/** The sizes a `b2b_price_required` refusal names; null for any other error. */
export function unpricedSizesOf(err: unknown): UnpricedSize[] | null {
  const data = (err as { data?: { code?: string; sizes?: UnpricedSize[] } } | null)?.data;
  return data?.code === B2B_PRICE_REQUIRED ? (data.sizes ?? []) : null;
}

/** A size the business would pay the shop price for — the API's rule. */
export function lacksB2bPrice(v: { b2b_price?: number | string | null; is_active?: boolean }): boolean {
  return v.is_active !== false && !(Number(v.b2b_price ?? 0) > 0);
}

export interface Product {
  id: string;
  name_es: string;
  name_en: string;
  description_es: string | null;
  description_en: string | null;
  brand: string | null;
  origin: string | null;
  /** FK to the partner store selling this product. Null = Cesto Shop default. */
  store_id: string | null;
  /** Compat alias — the associated store's slug. Kept during the shop→store
   *  rename so older frontends keep resolving; equal to `store?.slug ?? null`. */
  shop_id?: string | null;
  /** Partial store row when included in the API response. */
  store?: StoreSummary | null;
  category_id: string;
  subcategory_id: string | null;
  /** Third-tier taxonomy (2026-07-17). Optional — legacy products stay
   *  parked under just their subcategory. See ProductType. */
  product_type_id?: string | null;
  is_active: boolean;
  is_featured: boolean;
  /** Admin-curated paid placement — surfaces in the home Sponsored rail. */
  is_sponsored?: boolean;
  /** Admin-curated — surfaces in the home "New products" rail. Optional so an
   *  older API that predates the column still satisfies the type. */
  is_new_arrival?: boolean;
  /** Marketplace-trust badge — shown on product cards. */
  is_verified?: boolean;
  /** Best-selling product — shown on product cards. */
  is_top_seller?: boolean;
  /** Admin-curated. When true, the product detail page shows a "Request
   *  quotation" button. Optional so an older API that predates the column
   *  still satisfies the type. */
  is_quotation_enabled?: boolean;
  /**
   * Which kind of customer it is shown to (2026-10-25): both (the default),
   * B2C only, or B2B only. Optional so an older API still satisfies the type
   * — absent reads as `all`.
   */
  audience?: ProductAudience;
  /**
   * Spanish IVA band, and whether a human ever chose it.
   *
   * The schema defaults every product to `reduced` whether or not anyone
   * looked, so the band on its own says nothing. `vat_category_reviewed` is
   * the one that matters: until it is true the product's prices carry 0 %
   * (effectiveVatCategory in tax.ts), and the factura flags its lines.
   */
  vat_category_reviewed?: boolean;
  /** Average customer rating, 0–5 (one decimal). null if unrated. */
  rating?: number | null;
  /** Number of ratings the average is based on. */
  rating_count?: number | null;
  created_at: string;
  updated_at: string;
  category?: Category;
  subcategory?: SubCategory | null;
  product_type?: {
    id: string; subcategory_id: string; name_es: string; name_en: string;
  } | null;
  /** How the row was created. Optional: an API deployed before this shipped
   *  does not send it, and admin and API deploy independently. */
  created_source?: 'admin' | 'import' | 'partner' | 'quick_create';
  /** Flagged for a catalogue admin to complete what a quick-create left out. */
  review_needed?: boolean;
  /** Spanish IVA bucket. Rates live in tax.ts, not here. */
  vat_category?: VatCategory;
  variants?: ProductVariant[];
  images?: ProductImage[];
}

// ─── PRODUCT VARIANT ────────────────────────────────────

export interface ProductVariant {
  id: string;
  product_id: string;
  name_es: string;
  name_en: string;
  /** B2C / retail price shown to regular customers. */
  price: number;
  /** Strike-through / promo price shown next to `price` on the B2C surface. */
  compare_at_price: number | null;
  /**
   * Euros off one unit agreed with the signed-in customer (2026-10-25). When
   * set, `price` already has it taken off and `compare_at_price` is the
   * price it came off — what the API sends; nothing here subtracts it again.
   */
  customer_discount?: number | string | null;
  /** B2B / wholesale price. Only surfaced to B2B-role customers. Null if not set. */
  b2b_price?: number | null;
  /**
   * What Cesto pays for one — the buying price (2026-10-27); 0 = not entered.
   * ADMIN ONLY: the API leaves it out of every response but the admin product
   * routes, so on any other surface it is simply absent.
   */
  cost_price?: number | string;
  stock_quantity: number;
  low_stock_threshold: number;
  is_default: boolean;
  is_active: boolean;
  sku: string | null;
  created_at: string;
  updated_at: string;
}

// ─── STORE ──────────────────────────────────────────────

export type ShopHoursDay =
  | { closed: true }
  | { closed: false; open: string; close: string };

export type ShopHours = Partial<Record<
  'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun',
  ShopHoursDay
>>;

/** Minimal store shape included on a Product response. */
export interface StoreSummary {
  id: string;
  slug: string;
  name: string;
  logo_url: string | null;
  logo_bg: string;
  is_verified: boolean;
}

export interface Store {
  id: string;
  slug: string;
  name: string;
  tagline_es: string | null;
  tagline_en: string | null;
  description_es: string | null;
  description_en: string | null;
  logo_url: string | null;
  logo_bg: string;
  cover_url: string | null;
  rating: number | null;
  rating_count: number;
  followers_count: number;
  is_active: boolean;
  is_verified: boolean;
  fast_delivery: boolean;
  /** ISO 3166-1 alpha-2 market the store trades in. Optional on the type
   *  because customer-facing payloads omit it — only admin surfaces read it.
   *  Distinct from `origin`, which is the cuisine the store sells. */
  country?: string;
  /** Where the shop physically trades, one free-text line. Shown on the
   *  storefront beside the country. Purely descriptive: nothing filters,
   *  routes or prices on it, and it does not limit where the store
   *  delivers. */
  address?: string | null;
  origin: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  website_url: string | null;
  shop_hours: ShopHours | null;
  sort_order: number;
  /** 'manual' | 'import' — set by the Excel importer to flag stores it
   *  auto-created as suggestions. Only carries a value when the endpoint
   *  is served by a post-2026-07-14 API; older deploys omit it. */
  source?: 'manual' | 'import';

  // Soft-delete lifecycle — see feedback_store-soft-delete-pattern memory.
  // All four fields are optional so pre-2026-07-16 API deploys (which don't
  // return them) don't force runtime null-checks at every render site.
  /** Set when an admin scheduled deletion. Store hidden from customers
   *  immediately; grace period is 5 days before permanent-delete is
   *  allowed. Cleared by cancel-deletion. */
  deletion_scheduled_at?: string | null;
  deletion_scheduled_by_admin_id?: string | null;
  deletion_reason?: string | null;
  /** Tombstone. Set on permanent-delete (super_admin only, post-grace).
   *  Row preserved for order history; only surfaces in the Deleted stores
   *  archive where super_admin can restore. */
  deleted_at?: string | null;
  /** Nested only on GET /:id — admin who scheduled the deletion, for audit. */
  deletion_scheduled_by?: { name: string; email: string } | null;
  /** MV Slice 0 lifecycle. 'live' = customer-visible; 'draft' = admin-only
   *  (hidden by customerVisibleStoreFilter); 'suspended' also blocks partner
   *  login. Optional so older API responses without the column don't force
   *  runtime null-checks. */
  status?: 'draft' | 'live' | 'paused' | 'suspended';
  /** MV test-data flag. Every mv-created row uses is_test=true so cleanup on
   *  cutover is a single WHERE clause. customerVisibleStoreFilter also
   *  excludes is_test=true. */
  is_test?: boolean;
  created_at: string;
  updated_at: string;
  /** `sales_reps`: active reps selling from it; absent from an API before shops were assigned. */
  _count?: { products: number; sales_reps?: number };
}

export interface StoreCategoryCount {
  category_id: string;
  name_es: string;
  name_en: string;
  icon_url: string | null;
  count: number;
}

/** One canonical brand a store carries, with a count of its active products. */
export interface StoreBrandCount {
  brand_id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  logo_bg: string | null;
  count: number;
}

/** Extra fields the store detail endpoint returns beyond the base Store. */
export interface StoreDetail extends Store {
  is_open_now: boolean;
  is_followed: boolean;
  category_counts: StoreCategoryCount[];
  brand_counts: StoreBrandCount[];
  products_count: number;
}

// ─── PRODUCT IMAGE ──────────────────────────────────────

export interface ProductImage {
  id: string;
  product_id: string;
  url: string;
  alt_text: string | null;
  sort_order: number;
  is_primary: boolean;
  created_at: string;
}

// ─── ORDER ──────────────────────────────────────────────

export interface Order {
  id: string;
  order_number: string;
  user_id: string;
  /**
   * The customer who placed the order.
   *
   * Only the partner and admin order endpoints include it — a customer
   * fetching their own order is the user, so nothing serialises it there.
   * Optional for that reason, and because an older app build must not break
   * if a future response drops it.
   *
   * Declared here rather than cast at each call site: PartnerOrdersPage was
   * widening the type inline in two places, which meant the shape was
   * documented nowhere and checked nowhere.
   */
  user?: { name: string } | null;
  address_id: string;
  address_snapshot: Address;
  payment_method: PaymentMethod;
  subtotal: number;
  delivery_fee: number;
  /**
   * Recargo de equivalencia charged on this order (2026-11-04) — part of
   * `total`. Always 0 on a part of a split purchase (the purchase carries
   * it). Absent from an older API.
   */
  recargo?: number | string;
  /** The customer was under recargo de equivalencia when this was placed. */
  recargo_equivalencia?: boolean;
  total: number;
  /**
   * Was this bought by a wholesale account? Written at checkout from the
   * stored account, never from the request.
   *
   * The screens need it to read `delivery_fee: 0` correctly — for a b2b order
   * that means the office has not priced the drop yet, not that delivery is
   * free. See deliveryFeeIsPending(). Optional because an API deployed before
   * it was exposed sends no such field, and "not a business order" is the
   * right assumption when it is absent.
   */
  buyer_is_business?: boolean | null;
  status: OrderStatus;
  rider_id: string | null;
  customer_notes: string | null;
  admin_notes: string | null;
  cancelled_reason: string | null;
  created_at: string;
  updated_at: string;
  items?: OrderItem[];
  rider?: Pick<Rider, 'id' | 'name' | 'phone' | 'vehicle_type'> | null;
  // ─── MV Slice 4 additions ──────────────────────────────
  // Pre-mv rows and single-store legacy checkouts have both nullable
  // FK fields set to null. All embedded objects are optional so a
  // stale bundle that doesn't ask for them still parses the response.
  /** Non-null when this Order is a sub of a cross-store checkout. */
  parent_order_id?: string | null;
  /** Non-null when this Order is scoped to a specific partner store.
   *  Null = Cesto house store (matches Product.store_id convention). */
  store_id?: string | null;
  /** Loaded via `include: { parent_order: true }` on detail routes. */
  parent_order?: ParentOrder | null;
  /** Loaded via `include: { store: {...} }` — slim projection only. */
  store?: { id: string; slug: string; name: string; logo_url?: string | null } | null;
  /** A Home Grocery order: the household's plan, and its slot — the day
   *  (YYYY-MM-DD at UTC midnight) and the part of the day (null = any time).
   *  Optional — an older API sends none of them. */
  rashan_subscription_id?: string | null;
  scheduled_for?: string | null;
  delivery_window?: 'morning' | 'afternoon' | 'evening' | null;
  /** Populated on GET /api/orders/:id (customer + admin) when the fetched
   *  Order is a sub — the other subs sharing the same parent, slim shape. */
  sibling_orders?: Array<{
    id: string;
    order_number: string;
    status: OrderStatus;
    subtotal: number;
    delivery_fee: number;
    total: number;
    rider?: { id: string; name: string } | null;
    store?: { id: string; slug: string; name: string; logo_url?: string | null } | null;
    _count?: { items: number };
  }>;
  /** Soft-delete tombstone — set by an admin to hide the order everywhere
   *  except a direct lookup by id. Null on every normal, visible order. */
  deleted_at?: string | null;
  deleted_by_admin_id?: string | null;
  delete_reason?: string | null;
}

// ─── PARENT ORDER (MV Slice 4) ─────────────────────────
// Groups N sub-Orders created by one cross-store checkout. Has no `status`
// column of its own — derived from sub-order statuses (see parentOrder.ts
// on the API side). GET /api/orders/:id returns this shape when :id
// resolves to a parent (distinguishable by `sub_orders` being present).

// Only id + order_number are guaranteed on every response — every other
// field is optional because list endpoints project a slim shape (just id
// and number, used for "part of #X-P" chips) while detail endpoints
// return the full row. Matches how Order handles items/rider/delivery_slot.
export interface ParentOrder {
  id: string;
  order_number: string;
  user_id?: string;
  address_id?: string;
  address_snapshot?: Address;
  payment_method?: PaymentMethod;
  subtotal?: number;
  delivery_fee_total?: number;
  /** Recargo de equivalencia on the whole purchase (2026-11-04); part of `total`. */
  recargo?: number | string;
  recargo_equivalencia?: boolean;
  total?: number;
  customer_notes?: string | null;
  created_at?: string;
  updated_at?: string;
  sub_orders?: Order[];
  /** Server-computed status derived from the subs' statuses. See
   *  deriveParentOrderStatus in packages/api/src/lib/parentOrder.ts. */
  derived_status?: OrderStatus;
}

/**
 * One customer purchase, whatever shape the database had to store it in.
 *
 * Returned by GET /api/admin/orders?grouped=true. A checkout can land as a
 * single Order or as a ParentOrder with several sub-Orders — split by store,
 * and also by availability, since an out-of-stock item goes to its own
 * `draft` sub-order even when the cart never left one shop. Listing raw Order
 * rows shows that as several unrelated purchases; this is the group they
 * belong to.
 *
 * `id` is what to navigate to: the parent's id for a split, the order's own
 * id otherwise. Both resolve on GET /api/admin/orders/:id, which accepts
 * either shape.
 */
export interface AdminOrderGroup {
  id: string;
  /** The parent's "…-P" number for a split purchase, else the order's own. */
  order_number: string;
  /** True when a ParentOrder backs this group, however many subs survive. */
  is_split: boolean;
  /** Derived across the subs for a split — including `partially_completed`. */
  status: OrderStatus;
  total: number;
  subtotal: number;
  /** The whole purchase's delivery fee (parent total, not one sub's share). */
  delivery_fee: number;
  payment_method: PaymentMethod;
  created_at: string;
  /** `company` is a business account's trading name; optional, as an older API omits it. */
  user?: { id: string; name: string; phone: string | null; company?: string | null } | null;
  /** Items across every sub-order, not just the first. */
  item_count: number;
  /** Distinct stores in the purchase; `null` is the Cesto house store. */
  stores: Array<{ id: string; slug: string; name: string } | null>;
  /**
   * Who built it, when it was not the customer — staff or rep, at most one.
   *
   * One field with a flag rather than two nullable ones: the label is the
   * same question either way, and a screen only branches on whether there is
   * a page to link to. A split purchase is built once and stored as several
   * Orders, so this is the whole purchase's answer, not one part's.
   */
  built_by?: { id: string; name: string; is_rep: boolean } | null;
  /** A Home Grocery plan's delivery, and its planned day. Optional: an older API omits it. */
  plan?: { scheduled_for: string | null; skipped?: boolean } | null;
  /** Set only when one rider carries the whole purchase. */
  rider?: { id: string; name: string } | null;
  rider_count: number;
  /** Always the real Order rows — length 1 for an unsplit purchase. */
  sub_orders: Array<{
    id: string;
    order_number: string;
    status: OrderStatus;
    total: number;
    subtotal: number;
    delivery_fee: number;
    payment_method: PaymentMethod;
    created_at: string;
    parent_order_id: string | null;
    user?: { id: string; name: string; phone: string | null } | null;
    rider?: { id: string; name: string } | null;
    store?: { id: string; slug: string; name: string } | null;
    _count?: { items: number };
  }>;
}

// ─── ORDER ITEM ─────────────────────────────────────────

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string;
  variant_id: string;
  product_snapshot: {
    name_es: string;
    name_en: string;
    image_url: string;
    variant_name_es: string;
    variant_name_en: string;
  };
  quantity: number;
  unit_price: number;
  /**
   * Euros taken off this whole line. Null means never discounted.
   * `line_total` is already net of it — do not subtract it a second time.
   * Since 2026-10-25 it is `unit_discount` times the quantity.
   */
  discount_amount?: number | null;
  /** Euros off ONE unit (2026-10-25). Null on undiscounted and older lines. */
  unit_discount?: number | string | null;
  line_total: number;
  /**
   * What Cesto paid for ONE unit on this order — the line's buying price
   * (2026-10-27); copied from the size, then the admin's to correct. 0 = not
   * entered. ADMIN ONLY: absent from every other surface's payload.
   */
  unit_cost?: number | string;
  /**
   * The IVA rate `unit_price` was charged with (2026-11-01, when IVA became
   * part of the price). Null on older lines; see lineVatCategory.
   */
  tax_rate_pct?: number | null;
}

// ─── ORDER EDIT (partner/admin "Edit Order" feature) ────

export type OrderEditOperation =
  | { action: 'update_qty'; order_item_id: string; new_quantity: number }
  | { action: 'replace'; order_item_id: string; new_variant_id: string; new_quantity?: number }
  | { action: 'remove'; order_item_id: string }
  /** `unit_discount`: euros off one unit, remembered for the customer. Absent = their saved one. */
  | { action: 'add'; new_variant_id: string; new_quantity: number; unit_discount?: number }
  /**
   * `unit_discount`: euros off ONE unit (2026-10-25), remembered for the
   * customer; 0 clears it. `discount_amount`: the flat line figure an older
   * API reads — send it alongside, as unit × quantity, during a deploy.
   */
  | { action: 'set_discount'; order_item_id: string; discount_amount?: number; unit_discount?: number };

/**
 * A price agreed with one customer for one product size (2026-10-25): euros
 * off one unit, set on an order by staff or a rep and remembered. Prices are
 * per unit and for THIS customer — wholesale for a business.
 */
export interface CustomerProductDiscount {
  variant_id: string;
  product_id: string;
  /** Euros off one unit. */
  amount: number | string;
  updated_at: string;
  product: { name_es: string; name_en: string; brand: string | null; image_url: string | null; is_active: boolean };
  variant: { name_es: string; name_en: string; is_active: boolean };
  /** One unit without the discount, and with it. */
  price: number | string;
  customer_price: number | string;
  /** The order it was last set on. */
  order: { id: string; order_number: string } | null;
}

export interface EditOrderRequest {
  operations: OrderEditOperation[];
  /** Optional staff note, stored on every OrderEditLog row from this save. */
  note?: string;
}

export interface OrderEditLog {
  id: string;
  order_id: string;
  order_item_id: string;
  action: 'update_qty' | 'replace' | 'remove' | 'add';
  old_quantity: number | null;
  new_quantity: number | null;
  old_product_id: string | null;
  old_variant_id: string | null;
  old_snapshot: OrderItem['product_snapshot'] | null;
  new_product_id: string | null;
  new_variant_id: string | null;
  new_snapshot: OrderItem['product_snapshot'] | null;
  old_line_total: number | null;
  new_line_total: number | null;
  note: string | null;
  editor_type: 'admin' | 'partner';
  editor_admin_id: string | null;
  editor_partner_user_id: string | null;
  created_at: string;
}

/** A brand-new sub-order created because an admin added/replaced an item
 *  with a product from a different store than the order being edited. */
export interface EditOrderNewOrder {
  id: string;
  order_number: string;
  store_id: string | null;
  store_name: string | null;
  total: number;
}

export interface EditOrderResponse {
  order: Order;
  newOrders: EditOrderNewOrder[];
  /** The edit emptied a draft, so the server cancelled it (2026-11-04). */
  draftCancelled?: boolean;
}

// There is no DeliveryZone or DeliverySlot. Delivery coverage and booked
// time windows were removed on 2026-08-31 — every live store delivers
// everywhere, the delivery fee is one platform-wide setting, and every order
// is ASAP. See the DELIVERY note in packages/api/prisma/schema.prisma.

// ─── USER LOCATION ──────────────────────────────────────
// Where the browser says the customer is. This used to scope the catalogue
// to stores that could deliver there; it no longer filters anything, and
// survives only to pre-fill the address form from a detected position.
// `source` tells the UI whether the value came from GPS or was typed.

export interface Coords {
  lat: number;
  lng: number;
}

export type LocationSource = 'gps' | 'manual' | 'default';
export type LocationStatus =
  | 'idle'
  | 'requesting'
  | 'granted'
  | 'denied'
  | 'unavailable'
  | 'error';

export interface UserLocation {
  coords?: Coords;
  city: string;
  postcode: string;
  /** Full formatted address from the geocoder, when we have one. */
  formatted?: string;
  source: LocationSource;
  /** ISO timestamp of when this was captured — lets stores decide to refresh. */
  detected_at: string;
}

// ─── RIDER ──────────────────────────────────────────────

export interface Rider {
  id: string;
  name: string;
  phone: string;
  vehicle_type: VehicleType;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ─── HELP CENTER ────────────────────────────────────────

export interface HelpCategory {
  id: string;
  slug: string;
  title_en: string;
  title_es: string;
  /** Lucide icon name, resolved client-side via a fixed lookup map. */
  icon: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  articles?: HelpArticleSummary[];
  _count?: { articles: number };
}

export interface HelpArticleSummary {
  id: string;
  slug: string;
  title_en: string;
  title_es: string;
}

export interface HelpArticle extends HelpArticleSummary {
  category_id: string;
  body_en: string;
  body_es: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  category?: HelpCategory;
}

// ─── BANNER ─────────────────────────────────────────────

export interface Banner {
  id: string;

  // Bilingual content
  eyebrow_en: string | null;
  eyebrow_es: string | null;
  title_en: string;
  title_es: string;
  subtitle_en: string | null;
  subtitle_es: string | null;
  cta_en: string | null;
  cta_es: string | null;

  // Visual style
  background: string | null;
  text_theme: 'light' | 'dark';
  accent_color: string | null;
  scrim_color: string | null;
  show_eyebrow: boolean;

  // Imagery
  image_desktop: string;
  image_mobile: string;

  // Targeting / scheduling
  link_type: string | null;
  link_target: string | null;
  display_order: number;
  is_active: boolean;
  active_from: string | null;
  active_until: string | null;
  created_at: string;
  updated_at: string;
}
