import { api } from '../client';
import type { AdminOrderGroup, OrderBill, EditOrderRequest, CustomerProductDiscount, SalesRepStore, RepEarnings, RepOrderEarning, RepEntryDetail, ShopHours } from '../../types';
// Admin's own definitions, not a second pair: a rep's albarán is admin's
// albarán, drafted by the same lib and printed by the same component.
import type { Invoice, InvoiceBlocker } from './admin';
import type { VatCategory } from '../../tax';

/**
 * Sales-rep API surface — `/api/sales/*`.
 *
 * Every call goes through `requireSalesRep()` on the server, which turns the
 * ordinary customer JWT into an active rep or refuses. There is no rep token
 * and no rep login: a rep signs in at the storefront like anyone else.
 *
 * The scope is enforced server-side, not here. A rep sees accounts they opened
 * and accounts they have already built an order for; anything outside that
 * answers 404, so there is no client-side filtering to get wrong and no
 * `rep_id` parameter to forget.
 */

// ─── /me ────────────────────────────────────────────────

export interface SalesMeResponse {
  user: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    avatar_url: string | null;
    preferred_language: 'es' | 'en';
    password_is_temp: boolean;
  };
  rep: { code: string | null; granted_at: string };
  stats: {
    /** Since midnight, in the rep's own terms — not a rolling 24 hours. */
    today: { orders: number; revenue: string };
    /** Since the 1st, Madrid time (the dashboard's sales card). Absent from an older API. */
    this_month?: { orders: number; revenue: string };
    all_time: { orders: number; revenue: string };
    clients_opened: number;
  };
  /** Optional: an API deployed before this shipped sends no settings block. */
  settings?: {
    /** The standard fee, before a rep decides to waive it. */
    delivery_fee: string;
  };
  /**
   * The shops they sell from (2026-10-26). Empty = none assigned; absent = an
   * API from before, which must not be read as "none" — read it through
   * repStoresOf.
   */
  stores?: SalesRepStore[];
  /** The one shop of an API from 2026-10-25, before reps had several. */
  store?: SalesRepStore | null;
  /**
   * Products assigned to them by hand, from any shop, that they can sell now
   * (2026-10-27). With some, a rep without a shop still builds orders. Absent
   * on an older API — read as none.
   */
  assigned_products?: number;
}

// ─── Clients ────────────────────────────────────────────

/**
 * A client is the rep's own (they opened it) or one of their others —
 * somebody else's client they found by email or ordered for, which stays
 * whoever's it was (API lib/repClients, 2026-10-28).
 */
export type SalesClientRelation = 'own' | 'other';
/** Whose an "other" client is, in a word — never who: a rep's, the office's, or the shop's (signed themselves up). */
export type SalesClientOwner = 'rep' | 'office' | 'shop';

export interface SalesClientListItem {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  is_business: boolean;
  status: string;
  created_at: string;
  company: string | null;
  order_count: number;
  /** All absent from an API before 2026-10-28, which listed own clients only. */
  relation?: SalesClientRelation;
  owner?: SalesClientOwner | null;
  /** The rep's own placed orders for them. */
  my_order_count?: number;
  /** An other client: since when they serve them — found by email, or first ordered for. */
  served_since?: string | null;
  found_by_email?: boolean;
}

/** GET /api/sales/clients: a page of one tab, and the size of both. */
export type SalesClientsPage = Paged<SalesClientListItem> & {
  /** Absent from an older API. */
  counts?: { own: number; other: number };
};

/** POST /api/sales/clients/find — any client of Cesto, by their whole email. */
export interface SalesClientFind {
  found: boolean;
  /**
   * Found, but not someone to order for: the rep's own account, another
   * rep's, or a blocked one. Null or absent when they can be.
   */
  unavailable?: 'self' | 'sales_rep' | 'blocked' | null;
  client?: {
    id: string;
    name: string;
    company: string | null;
    email: string | null;
    phone: string | null;
    is_business: boolean;
    pricing_mode: string;
    status: string;
    relation: SalesClientRelation;
    owner: SalesClientOwner | null;
    address_count: number;
    my_order_count: number;
  };
}

export interface SalesAddress {
  id: string;
  label: string | null;
  contact_name: string;
  contact_phone: string;
  street_line_1: string;
  street_line_2: string | null;
  postcode: string;
  city: string;
  province: string;
  delivery_notes: string | null;
  is_default: boolean;
}

export interface SalesClient {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  is_business: boolean;
  pricing_mode: string;
  status: string;
  preferred_language: 'es' | 'en' | null;
  /** CIF/NIF. One of the three conditions that gate factura vs albarán. */
  tax_id: string | null;
  /** Under recargo de equivalencia (2026-11-04) — set by the office; absent from an older API. */
  recargo_equivalencia?: boolean;
  business_profile: {
    company: string;
    contact_phone: string | null;
    /** A company registry number. Only stands in for the CIF on accounts
     *  approved before there was anywhere to put one. */
    registration_no: string | null;
  } | null;
  addresses: SalesAddress[];
  /**
   * A Home Grocery household's plan: what an order's day and part of the day
   * are suggested from, and whether one is due. Null for everyone else;
   * absent from an older API.
   */
  home_grocery?: SalesClientHomeGrocery | null;
  /** The rep's client profile (2026-10-26). All absent from an older API. */
  phone_country_code?: string | null;
  created_at?: string;
  opened_by_me?: boolean;
  /**
   * How they get into the shop: no login yet, a temporary password somebody
   * issued, or their own (a password they chose, or Google/Apple). A rep may
   * issue credentials for the first two only.
   */
  access?: 'none' | 'temporary' | 'own';
  /** THIS rep's orders for them: drafts not counted, cancelled ones not in `spent`. */
  stats?: { orders: number; spent: number | string; last_order_at: string | null };
  /** Their own, or somebody else's they reach (2026-10-28). Absent from an older API: own. */
  relation?: SalesClientRelation;
  owner?: SalesClientOwner | null;
  /** When they found them by email, if they did. */
  found_at?: string | null;
}

/** A login the rep issued, to copy or send — shown once, never readable again. */
export interface SalesClientCredentials {
  rotated: boolean;
  /** The username: their email. */
  login_email: string;
  temp_password: string;
  /** The shop's sign-in page, for the message. */
  login_url: string;
  email_sent: boolean;
  /** Why nothing was mailed, when nothing was. */
  reason: string | null;
}

export interface SalesClientHomeGrocery {
  status: 'active' | 'paused';
  frequency: 'weekly' | 'biweekly' | 'every_3_weeks' | 'monthly' | 'every_6_weeks';
  /** ISO weekday, 1 = Monday. */
  preferred_weekday: number | null;
  preferred_window: 'morning' | 'afternoon' | 'evening' | null;
  address_id: string;
  /** YYYY-MM-DD. */
  next_due: string;
  due: boolean;
}

export interface SalesAddressInput {
  label?: string;
  contact_name: string;
  contact_phone: string;
  street_line_1: string;
  street_line_2?: string;
  postcode: string;
  city: string;
  province: string;
  delivery_notes?: string;
}

/**
 * No `sales_manager_name` and no `vendor`. The server sets the first to the
 * rep's own name and refuses the second outright — both are absent here so the
 * app cannot be written to send them and then be surprised.
 */
export interface SalesNewClientPayload {
  name: string;
  email: string;
  phone?: string;
  phone_country_code?: string;
  preferred_language?: 'es' | 'en';
  client_type: 'retail' | 'business';
  business?: {
    company: string;
    business_type?: string;
    location?: string;
    website?: string;
    registration_no?: string;
    contact_phone?: string;
  };
  address: SalesAddressInput;
  send_credentials?: boolean;
}

export interface SalesNewClientResponse {
  client: SalesClient;
  email_sent: boolean;
  /** True when an existing customer was upgraded rather than a new row added.
   *  The rep needs to know: "created" would send them looking for a second
   *  account that does not exist. */
  was_existing: boolean;
  /** An existing account that kept its own login (a chosen password, or
   *  Google/Apple): nothing was issued and no credentials email went out.
   *  Absent from an API before 2026-10-26. */
  kept_password?: boolean;
}

// ─── Catalogue ──────────────────────────────────────────
//
// Shapes mirror the admin catalogue exactly, because the rep order screen is a
// port of the admin one and its panel reads these fields by name. The server
// serves `Product` rows with nested variants, already priced for the client
// (`for_client`) and with `b2b_price` dropped — see routes/sales/catalogue.ts.

/** Same filter surface as AdminProductsListParams, minus the flags a rep has
 *  no business filtering on (review queues, sponsorship, verification). */
export interface SalesProductsListParams {
  q?: string;
  categoryId?: string;
  subcategoryId?: string;
  productTypeId?: string;
  /** Store uuid, or the literal 'cesto' for house-store products. */
  storeId?: string | 'cesto';
  brandId?: string;
  originId?: string;
  stock?: 'in' | 'out' | 'low';
  /** Accepted so the ported panel can send what it always sent. The server
   *  forces active regardless — a rep cannot sell an inactive product. */
  isActive?: 'true' | 'false';
  sort?: 'newest' | 'oldest' | 'name_asc' | 'name_desc' | 'rating_desc';
  /** Prices every variant for this client. Must be one of the rep's own. */
  for_client?: string;
  /** The Catálogo tab, with no client: every size keeps its retail `price`
   *  and carries `b2b_price` too. Ignored alongside `for_client`. */
  prices?: 'both';
  /** One product, still within every rule above (the Catálogo's "new order"). */
  productId?: string;
  /** Only the products assigned to this rep by hand — the "Asignados" chip. */
  assigned?: 'true';
  page?: number;
  limit?: number;
}

export interface SalesProductVariant {
  id: string;
  name_es: string;
  name_en: string;
  sku: string | null;
  /** ALREADY the price this client pays — retail when browsing. */
  price: number;
  /** Only with `prices: 'both'` (the Catálogo tab): the wholesale price, or
   *  null where a business pays retail. Never sent for a client. */
  b2b_price?: number | string | null;
  /** Null whenever a wholesale price applied — a retail "was" above a trade
   *  price would read as a discount nobody is offering. */
  compare_at_price: number | null;
  stock_quantity: number;
  low_stock_threshold: number;
  is_default: boolean;
}

export interface SalesProduct {
  id: string;
  name_es: string;
  name_en: string;
  description_es: string | null;
  description_en: string | null;
  brand: string | null;
  brand_id: string | null;
  origin: string | null;
  origin_id: string | null;
  store_id: string | null;
  category_id: string;
  subcategory_id: string | null;
  product_type_id: string | null;
  is_active: boolean;
  is_featured: boolean;
  is_sponsored: boolean;
  is_new_arrival: boolean;
  is_verified: boolean;
  is_top_seller: boolean;
  is_quotation_enabled: boolean;
  rating: number | null;
  rating_count: number;
  vat_category: VatCategory;
  /** Whether somebody chose that band; until then the prices carry 0 %. Absent on an older API. */
  vat_category_reviewed?: boolean;
  /** Who it is shown to. Absent on an API from before 2026-10-26. */
  audience?: 'all' | 'b2c' | 'b2b';
  /** Assigned to this rep by hand, from any shop (2026-10-27). Absent on an older API. */
  assigned?: boolean;
  created_at: string;
  updated_at: string;
  category: { id: string; name_es: string } | null;
  store: { id: string; slug: string; name: string } | null;
  brand_ref: { id: string; name: string; slug: string; logo_url: string | null; logo_bg: string | null } | null;
  origin_ref: { id: string; key: string; label_es: string; label_en: string } | null;
  variants: SalesProductVariant[];
  images: { url: string }[];
}

export interface SalesCategory {
  id: string;
  name_es: string;
  name_en: string;
  icon_url: string | null;
  bg_color: string | null;
  accent_color: string | null;
  sort_order: number;
  is_active: boolean;
  _count: { subcategories: number; products: number };
  /** Active products in the rep's shop; absent from an API before shops. */
  shop_products?: number;
}

export interface SalesSubcategory {
  id: string;
  category_id: string;
  name_es: string;
  name_en: string;
  sort_order: number;
  is_active: boolean;
  category: { id: string; name_es: string };
}

export interface SalesBrand {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  logo_bg: string | null;
  link: string | null;
  is_active: boolean;
  sort_order: number;
  /** The rep's active products under it — the browse card's number. Absent from an API before 2026-10-28. */
  products?: number;
}

export interface SalesOrigin {
  id: string;
  key: string;
  label_es: string;
  label_en: string;
  bg_color: string | null;
  accent_color: string | null;
  image_url: string | null;
  link: string | null;
  is_active: boolean;
  sort_order: number;
  /** The rep's active products from it. Absent from an API before 2026-10-28. */
  products?: number;
}

export interface SalesStore {
  id: string;
  slug: string;
  name: string;
  logo_url: string | null;
  logo_bg: string | null;
  status: string;
  is_verified: boolean;
  /** Every product it has, in any state. */
  _count: { products: number };
  // The Catálogo's shop card (2026-10-28) — absent from an API before it.
  cover_url?: string | null;
  tagline_es?: string | null;
  tagline_en?: string | null;
  shop_hours?: ShopHours | null;
  /** Its active products — what the rep finds behind its card. */
  products?: number;
}

// ─── Orders ─────────────────────────────────────────────

/**
 * One order, in full, as the rep detail page reads it.
 *
 * Deliberately loose on `items` and the money fields: the page is a port of
 * admin's and reads them through the same helpers, which already accept what
 * the API sends. Pinning them again here would be a second definition of the
 * same rows, free to disagree with the first.
 */
export interface SalesOrderDetail {
  id: string;
  order_number: string;
  status: string;
  subtotal: string;
  delivery_fee: string;
  /** Recargo de equivalencia charged (2026-11-04) — part of `total`; absent from an older API. */
  recargo?: string;
  /** The client was under recargo de equivalencia when this was placed. */
  recargo_equivalencia?: boolean;
  total: string;
  payment_method: string;
  customer_notes: string | null;
  admin_notes: string | null;
  cancelled_reason: string | null;
  created_at: string;
  parent_order_id: string | null;
  address_snapshot: Record<string, unknown> | null;
  items: Array<Record<string, unknown>>;
  user: {
    id: string; name: string; email: string | null; phone: string | null;
    tax_id: string | null; is_business: boolean; pricing_mode: string;
    business_profile: { company: string; contact_phone: string | null; registration_no: string | null } | null;
  };
  address: Record<string, unknown> | null;
  /** Read-only here. The page still SAYS who is carrying it — a rep asked
   *  "where is my order" needs the answer, they just do not set it. */
  rider: { id: string; name: string; phone: string | null } | null;
  store: { id: string; slug: string; name: string } | null;
  /** Albaranes only. A factura is the office's: a rep never receives one. */
  invoices: Array<{
    id: string; invoice_number: string | null; kind: string;
    status: string; issue_date: string | null;
  }>;
  /**
   * The office has invoiced this order, so it can no longer change. All a rep is
   * told about a factura. Absent from an API older than 2026-11-07.
   */
  factura_issued?: boolean;
  /** Set when this order is one part of a split purchase. */
  parent_order: {
    id: string; order_number: string; subtotal: string;
    delivery_fee_total: string; total: string; payment_method: string; created_at: string;
  } | null;
  /** The other parts, so a part is never mistaken for the whole. */
  sibling_orders: Array<{
    id: string; order_number: string; status: string; total: string;
    store: { id: string; name: string } | null;
    _count: { items: number };
  }>;
  /** What they earn from it — the whole breakdown, never a buying price. Absent from an API before 2026-10-28. */
  earning?: RepOrderEarning | null;
}

export interface SalesOrderListItem {
  id: string;
  order_number: string;
  status: string;
  total: string;
  created_at: string;
  item_count: number;
  client: { id: string; name: string; phone: string | null; company: string | null };
}

export interface SalesNewOrderPayload {
  user_id: string;
  address_id: string;
  payment_method?: 'cod' | 'card' | 'bizum';
  /**
   * Flat euros off a line, set while building the order.
   *
   * Optional, so a caller that does not send it behaves exactly as before —
   * which matters while an older bundle talks to a newer API.
   */
  /** `unit_discount`: euros off one unit, remembered for the client; send `discount_amount` = unit × quantity alongside for an older API. */
  items: Array<{ variant_id: string; quantity: number; discount_amount?: number; unit_discount?: number }>;
  /** Omit to let the server price it from settings + the address. */
  delivery_fee?: number;
  /** Park it instead of placing it. A draft reserves no stock. */
  status?: 'draft';
  customer_notes?: string;
  /** One of a Home Grocery household's orders: its day and part of the day. */
  home_grocery?: { scheduled_for: string; delivery_window?: 'morning' | 'afternoon' | 'evening' | null };
}

/** The shortfall shape editOrder uses, so one renderer serves every stock
 *  refusal in the app. */
export interface SalesStockShortfall {
  productName: string;
  needed: number;
  available: number;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export const salesMe = {
  get: () => api.get<SalesMeResponse>('/api/sales/me'),
};

export interface SalesClientLookup {
  /** An account already exists on that email. NOT an error — the create
   *  resolves to it rather than refusing. */
  email_taken: boolean;
  /** Somebody ELSE's number. A hard stop: User.phone is unique. */
  phone_taken: boolean;
  /** Set only when the match is already one of their own clients. The server
   *  will not name anybody outside the rep's book. */
  existing_client: { id: string; name: string } | null;
  /** The email is the office's or another rep's client: opening it is
   *  refused. Says that it is somebody's, never whose. Absent from an older API. */
  belongs_elsewhere?: boolean;
  /** Somebody else's client this rep already reaches — found by email or
   *  ordered for — to point to rather than open again. Absent from an older API. */
  reachable_client?: { id: string; name: string } | null;
}

export const salesClients = {
  lookup: (params: { email?: string; phone?: string }) =>
    api.get<SalesClientLookup>('/api/sales/clients/lookup', params),
  list: (params: { q?: string; page?: number; limit?: number; relation?: 'own' | 'other' | 'all' } = {}) =>
    api.get<SalesClientsPage>('/api/sales/clients', params),
  /** Any client of Cesto, by their whole email. Found, they are in the rep's reach — but not theirs. */
  find: (email: string) => api.post<SalesClientFind>('/api/sales/clients/find', { email }),
  get: (id: string) => api.get<SalesClient>(`/api/sales/clients/${id}`),
  /** The prices agreed with this client — euros off one unit per product size. */
  productDiscounts: (id: string) => api.get<CustomerProductDiscount[]>(`/api/sales/clients/${id}/product-discounts`),
  create: (payload: SalesNewClientPayload) =>
    api.post<SalesNewClientResponse>('/api/sales/clients', payload),
  addAddress: (id: string, payload: SalesAddressInput) =>
    api.post<SalesAddress>(`/api/sales/clients/${id}/addresses`, payload),
  /** A new temporary password for their shop login; mailed only with `send_email`. */
  issueCredentials: (id: string, payload: { send_email?: boolean } = {}) =>
    api.post<SalesClientCredentials>(`/api/sales/clients/${id}/credentials`, payload),
};

export const salesCatalogue = {
  products: (params: SalesProductsListParams = {}) => api.get<Paged<SalesProduct>>(
    '/api/sales/catalogue/products',
    params as Record<string, string | number | boolean | undefined | null>,
    { timeoutMs: 30_000 },
  ),
  categories: () => api.get<SalesCategory[]>('/api/sales/catalogue/categories'),
  subcategories: () => api.get<SalesSubcategory[]>('/api/sales/catalogue/subcategories'),
  brands: () => api.get<SalesBrand[]>('/api/sales/catalogue/brands'),
  origins: () => api.get<SalesOrigin[]>('/api/sales/catalogue/origins'),
  stores: (params: { page?: number; limit?: number } = {}) =>
    api.get<Paged<SalesStore>>('/api/sales/catalogue/stores', params),
};

/**
 * A product a rep adds at the counter.
 *
 * Narrower than the admin payload: `store_id` may only name one of the
 * rep's own shops, and there is no trade price — a margin decision that
 * twenty seconds at a counter is not when to make. See
 * routes/sales/products.ts.
 */
export interface SalesQuickProductPayload {
  name_es: string;
  name_en: string;
  category_id: string;
  brand?: string;
  /** Asked, never defaulted — this is the one moment somebody is holding the
   *  product and the answer is cheap. */
  vat_category: VatCategory;
  price: number;
  stock_quantity?: number;
  sku?: string;
  image_url?: string;
  /** Which of the rep's shops it goes into — 'cesto' for Cesto's own.
   *  Needed when they have several; with one, the server files it there. */
  store_id?: string;
}

export const salesProducts = {
  quickCreate: (payload: SalesQuickProductPayload) =>
    api.post<SalesProduct>('/api/sales/products/quick', payload),
};

/**
 * What a rep may do to an order they built.
 *
 * Each of these is their own work on something they made minutes ago. The
 * absences are the permission and they are absences on the SERVER — there is
 * no delete, no rider and no invoice issuing under /api/sales/*, so there is
 * nothing here that could call one.
 */
/**
 * A rep's own documents.
 *
 * Only read and issue. There is no editor and no delete on this surface:
 * retyping a draft's prices is an office job, and an issued document is
 * corrected by a credit note, which is not a rep's to make.
 */
/** Their own earnings: the balance, its history, and their orders on the way. Read-only. */
export const salesEarnings = {
  list: () => api.get<RepEarnings>('/api/sales/earnings'),
  /** One line of their history, opened. */
  entry: (id: string) => api.get<RepEntryDetail>(`/api/sales/earnings/entries/${id}`),
};

export const salesInvoices = {
  get: (id: string) => api.get<Invoice>(`/api/sales/invoices/${id}`),
  /** Allocates the number. The answer carries everything the PDF prints. */
  issue: (id: string) =>
    api.post<{ invoice: Invoice; kind: 'albaran' | 'invoice' }>(
      `/api/sales/invoices/${id}/issue`,
      {},
    ),
  /** Keeps the exact PDF of an albarán just issued, for the office's archive. */
  savePdf: (id: string, file: { name: string; bytes: Uint8Array }) => {
    const form = new FormData();
    form.append('file', new Blob([file.bytes as BlobPart], { type: 'application/pdf' }), file.name);
    return api.post<{ status: 'saved' | 'already' }>(
      `/api/sales/invoices/${id}/pdf`, form, { multipart: true, timeoutMs: 60_000 },
    );
  },
};

export const salesOrders = {
  list: (params: { status?: string; client?: string; page?: number; limit?: number } = {}) =>
    api.get<Paged<SalesOrderListItem>>('/api/sales/orders', params),
  /**
   * One row per PURCHASE rather than per Order row.
   *
   * Same shape the admin list renders, because it is the same server function:
   * a checkout can be several Orders, and a rep reading a part-total as the
   * whole order would quote the client the wrong number.
   */
  listGrouped: (params: { status?: string; q?: string; client?: string; page?: number; limit?: number } = {}) =>
    api.get<Paged<AdminOrderGroup>>('/api/sales/orders', { ...params, grouped: 'true' }),
  get: (id: string) => api.get<SalesOrderDetail>(`/api/sales/orders/${id}`),
  /** The Bill for an order they built: our company name, the client's name, lines and totals. */
  bill: (id: string) => api.get<OrderBill>(`/api/sales/orders/${id}/bill`),
  /**
   * Edit, cancel and confirm-stock wait 30s, not the 10s default — as the
   * admin's edit already did. The server may queue for a connection (up to
   * 5s) and then run its transaction (up to 8s); a screen that gives up
   * first tells the rep "failed" about a change that may still land.
   */
  editItems: (id: string, payload: EditOrderRequest, progressKey?: string) =>
    api.put<{ order: unknown; newOrders: unknown[]; draftCancelled?: boolean }>(`/api/sales/orders/${id}/items`, payload, {
      timeoutMs: 30_000,
      ...(progressKey ? { headers: { 'X-Progress-Key': progressKey } } : {}),
    }),
  /** The one status change that is theirs: the client changed their mind. */
  cancel: (id: string, reason?: string, progressKey?: string) =>
    api.put<unknown>(`/api/sales/orders/${id}/cancel`, { reason }, {
      timeoutMs: 30_000,
      ...(progressKey ? { headers: { 'X-Progress-Key': progressKey } } : {}),
    }),
  /** A parked draft holds nothing. This is where it takes its stock. */
  confirmStock: (id: string) =>
    api.post<unknown>(`/api/sales/orders/${id}/confirm-stock`, {}, { timeoutMs: 30_000 }),
  setDeliveryFee: (id: string, deliveryFee: number) =>
    api.put<{ id: string; subtotal: string; delivery_fee: string; total: string }>(
      `/api/sales/orders/${id}/delivery-fee`,
      { delivery_fee: deliveryFee },
    ),
  /**
   * Draft an albarán for an order the rep built. The only document a rep makes:
   * a factura is the office's alone. The kind is still named, so the server
   * never has to guess.
   */
  draftInvoice: (id: string, kind: 'albaran') =>
    api.post<{ invoice: Invoice; blockers: InvoiceBlocker[]; kind: 'albaran' | 'invoice' }>(
      `/api/sales/orders/${id}/invoice`,
      { kind },
    ),
  /** The CLIENT's note — "leave it next door" — never the internal ops one. */
  setNotes: (id: string, customerNotes: string) =>
    api.put<{ id: string; customer_notes: string | null }>(
      `/api/sales/orders/${id}/notes`,
      { customer_notes: customerNotes },
    ),
  /**
   * 30s, and an attempt key: a retry after a lost answer gets the order the
   * first press made instead of a second one (lib/createOrder.ts).
   */
  create: (payload: SalesNewOrderPayload, idempotencyKey?: string) =>
    api.post<{
      order: { id: string; order_number: string; status: string; total: string };
      delivery_fee_resolved: string;
      delivery_fee_applied: string;
    }>('/api/sales/orders', payload, {
      timeoutMs: 30_000,
      ...(idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : {}),
    }),
};
