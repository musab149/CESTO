import { api, getApiBaseUrl } from '../client';
import { getTokenStorage } from '../storage';
import type {
  Product, Order, Rider, Store, PartnerCategorySubmission, EditOrderRequest, EditOrderResponse,
} from '../../types';

/**
 * Partner-scoped API surface — Slice 3 dashboard. Every call goes through
 * requirePartnerRole() on the server, which forces store_id from the JWT
 * so no client-supplied store_id ever wins. Types mirror admin's shapes
 * so the same React components can render both.
 */

// ─── /api/partner/me + store ─────────────────────────────

export interface PartnerStore {
  id: string;
  slug: string;
  name: string;
  logo_url: string | null;
  logo_bg: string | null;
  is_verified: boolean;
  status: 'draft' | 'live' | 'paused' | 'suspended';
  contact_email: string | null;
  contact_phone: string | null;
}

export interface PartnerUser {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
  preferred_language: 'es' | 'en';
  password_is_temp: boolean;
}

export interface PartnerMeResponse {
  user: PartnerUser;
  role: 'owner' | 'manager';
  store: PartnerStore;
}

// PartnerStorePayload = every field the partner may edit. Deliberately
// omits is_verified / slug / etc. (admin-only). `status` is present but
// restricted to `'live' | 'paused'` — self-serve pause + un-pause; the
// draft/suspended transitions stay admin-only. See routes/partner/store.ts.
export interface PartnerStorePayload {
  name?: string;
  tagline_es?: string | null;
  tagline_en?: string | null;
  description_es?: string | null;
  description_en?: string | null;
  logo_url?: string | null;
  logo_bg?: string;
  cover_url?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  website_url?: string | null;
  origin?: string | null;
  fast_delivery?: boolean;
  status?: 'live' | 'paused';
  shop_hours?: Record<string, unknown> | null;
}

// ─── Products ────────────────────────────────────────────

export interface PartnerProductsListParams {
  q?: string;
  categoryId?: string;
  subcategoryId?: string;
  productTypeId?: string;
  brandId?: string;
  originId?: string;
  isActive?: 'true' | 'false' | boolean;
  stock?: 'in' | 'out' | 'low';
  hasOrders?: 'true' | 'false' | boolean;
  sort?: 'newest' | 'oldest' | 'name_asc' | 'name_desc' | 'rating_desc';
  page?: number;
  limit?: number;
}

// ─── Orders ──────────────────────────────────────────────

export interface PartnerOrdersListParams {
  status?: 'pending' | 'confirmed' | 'preparing' | 'on_the_way' | 'delivered' | 'cancelled';
  q?: string;
  from?: string;   // ISO datetime
  to?: string;
  riderId?: string;
}

export type PartnerOrderStatusTarget = 'confirmed' | 'preparing' | 'on_the_way' | 'delivered';

// ─── Riders ──────────────────────────────────────────────

export interface PartnerRiderPayload {
  name: string;
  phone: string;
  vehicle_type: 'moto' | 'bicicleta' | 'coche';
  is_active?: boolean;
}

// ─── Services ────────────────────────────────────────────

export const partnerAuth = {
  me(): Promise<PartnerMeResponse> {
    return api.get<PartnerMeResponse>('/api/partner/me');
  },
};

// ─── Dashboard ──────────────────────────────────────────

export type PartnerDashboardRange = 'today' | '7d' | '30d' | 'month' | 'year';

export interface PartnerDashboardStats {
  range: PartnerDashboardRange;
  from: string;
  to: string;
  period: { orders: number; revenue: number };
  pendingOrders:      number;
  activeOrders:       number;
  /** Confirmed/preparing/on_the_way orders without a rider — a direct
   *  action item for the partner. */
  unassignedOrders:   number;
  /** Distinct customers who have ever placed an order that included at
   *  least one product from this store. */
  totalCustomers:     number;
  totalProducts:      number;
  activeProducts:     number;
  lowStockVariants:   number;
  outOfStockVariants: number;
  activeRiders:       number;
  /** Setup-checklist booleans so the frontend can render a "get your
   *  storefront ready" card until every step is done. */
  setup: {
    hasLogo:          boolean;
    hasCover:         boolean;
    hasContactEmail:  boolean;
    hasShopHours:     boolean;
    hasProducts:      boolean;
    /** Replaced hasDeliveryZones — a partner sells everywhere, so the
     *  geographic step is stating where the shop actually is. */
    hasAddress:       boolean;
    hasRiders:        boolean;
  };
  setupDoneCount:  number;
  setupTotalCount: number;
  /** Lifecycle state, so the dashboard can explain a store that is not yet
   *  visible. `draft` means Cesto has not approved it — only an admin can
   *  move it to `live`. */
  storeStatus:      'draft' | 'live' | 'paused' | 'suspended';
  awaitingApproval: boolean;
}

export interface PartnerRecentOrder {
  id: string;
  order_number: string;
  status: 'pending' | 'confirmed' | 'preparing' | 'on_the_way' | 'delivered' | 'cancelled' | 'draft';
  total: number | string;
  created_at: string;
  user:   { name: string } | null;
  rider:  { id: string; name: string } | null;
  _count: { items: number };
}

export const partnerDashboard = {
  stats(params: { range?: PartnerDashboardRange } = {}) {
    return api.get<PartnerDashboardStats>('/api/partner/dashboard/stats', params);
  },
  recentOrders() {
    return api.get<PartnerRecentOrder[]>('/api/partner/dashboard/recent-orders');
  },
};

export const partnerStore = {
  get: () => api.get<Store & { _count: { products: number } }>('/api/partner/store'),
  update: (payload: PartnerStorePayload) => api.patch<Store>('/api/partner/store', payload),
};

// ─── Duplicates + Import support types ──────────────────
// Shape-parity with admin's duplicates response so the partner UI can use
// the same table/side-by-side/merge logic as the admin's duplicates page,
// while every DB read stays scoped to req.partnerRole.store.id server-side.

export type PartnerDuplicateMatchReason = 'same_name' | 'same_brand_variant' | 'same_image';

export interface PartnerDuplicateVariantSnapshot {
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

export interface PartnerProductDuplicateEntry {
  id: string;
  name_es: string;
  name_en: string;
  brand: string | null;
  is_active: boolean;
  category_id: string;
  created_at: string;
  variant_count: number;
  image_count: number;
  order_item_count: number;
  /** Always empty for partners — rashan is Cesto-only. Kept for shape parity. */
  rashan_pack_names?: string[];
  primary_image_url?: string | null;
  first_variant_name?: string | null;
  store_id?: string | null;
  store?: { id: string; slug: string; name: string } | null;
  variants?: PartnerDuplicateVariantSnapshot[];
}

export interface PartnerProductDuplicateGroup {
  key: string;
  label: string;
  /** Optional as of the identity-based rewrite: detection now matches on ALL
   *  identity fields at once, so per-signal reasons became redundant and the
   *  API stopped emitting them. Kept in the shape so an admin bundle that
   *  still renders the pills does not break. */
  match_reasons?: PartnerDuplicateMatchReason[];
  /** Always false in the partner scope — one store, so it can't be cross-store. */
  is_cross_store: boolean;
  products: PartnerProductDuplicateEntry[];
}

export interface PartnerProductDuplicatesResponse {
  groups: PartnerProductDuplicateGroup[];
  /** Always empty for a partner — one store, so the same identity cannot span
   *  two. Present so the shape matches admin's. */
  multi_store_listings?: PartnerProductDuplicateGroup[];
  total_groups: number;
  total_duplicate_products: number;
  total_multi_store_groups?: number;
  total_multi_store_products?: number;
}

export interface PartnerResolveDuplicatesResult {
  groups_processed: number;
  deactivated: number;
  deleted: number;
  skipped: Array<{ id: string; reason: string }>;
  failed:  Array<{ id: string; error: string }>;
}

export interface PartnerMergeDuplicatesResult {
  groups_processed: number;
  merged_variants: number;
  merged_images: number;
  deleted: number;
  skipped: Array<{ id: string; reason: string }>;
  failed:  Array<{ id: string; error: string }>;
}

// ─── Bulk import shapes (mirror admin's) ────────────────

export type PartnerImportJobStatus = 'queued' | 'running' | 'done' | 'failed' | 'interrupted';

export interface PartnerBulkImportRowResult {
  row: number;
  product_key: string;
  status: 'created' | 'skipped' | 'error' | 'pending_category' | 'duplicate';
  productId?: string;
  productName?: string;
  variantCount?: number;
  error?: string;
  pending_category_name?: string;
  warnings?: string[];
  duplicate_of_id?: string;
  duplicate_of_source?: 'product' | 'pending';
}

export interface PartnerBulkImportResult {
  total: number;
  created: number;
  failed: number;
  pending?: number;
  duplicates?: number;
  results: PartnerBulkImportRowResult[];
  unknownBrands?:  Array<{ name: string; count: number }>;
  unknownOrigins?: Array<{ name: string; count: number }>;
}

export interface PartnerImportJobEnqueueResult {
  jobId: string;
  replay?: boolean;
  alreadyRunning?: boolean;
  status?: PartnerImportJobStatus;
}

export interface PartnerImportJob {
  id: string;
  status: PartnerImportJobStatus;
  processed: number;
  total: number | null;
  result?: PartnerBulkImportResult | null;
  error_message: string | null;
  filename: string;
  file_size: number;
  created_at: string;
  started_at:  string | null;
  finished_at: string | null;
}

// ─── Import duplicates (staged spreadsheet rows) ────────
// Rows the partner importer flagged as duplicating a product already in the
// store, held for review rather than silently skipped. Separate queue from
// `listDuplicates` above: that one finds duplicates already IN the catalogue,
// this one holds rows that were never created.

export type PartnerImportDuplicateStatus = 'pending' | 'created' | 'dismissed';

export interface PartnerImportDuplicateVariantPayload {
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

export interface PartnerImportDuplicatePayload {
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
  is_active: boolean;
  variants: PartnerImportDuplicateVariantPayload[];
  image_urls: string[];
}

export interface PartnerProductImportDuplicate {
  id: string;
  job_id: string;
  source_row_number: number;
  payload: PartnerImportDuplicatePayload;
  matched_product_id: string | null;
  matched_product_name: string;
  status: PartnerImportDuplicateStatus;
  created_at: string;
  resolved_at: string | null;
  /** Null once the matched product is deleted — `matched_product_name` still
   *  carries the display name. */
  matched_product: {
    id: string;
    name_es: string;
    name_en: string;
    brand: string | null;
    origin: string | null;
    is_active: boolean;
    images: { url: string }[];
    _count: { variants: number };
  } | null;
  job: { id: string; filename: string; created_at: string } | null;
}

export interface PartnerProductImportDuplicatesResponse {
  items: PartnerProductImportDuplicate[];
  total: number;
}

export const partnerProducts = {
  list: (params: PartnerProductsListParams = {}) =>
    api.get<{ items: Product[]; total: number; page: number; totalPages: number }>(
      '/api/partner/products',
      params as Record<string, string | number | boolean | undefined | null>,
    ),
  get:    (id: string) => api.get<Product>(`/api/partner/products/${id}`),
  create: (payload: Partial<Product> & { variants: unknown[]; images: unknown[] }) =>
    api.post<Product>('/api/partner/products', payload),
  update: (id: string, payload: Partial<Product> & { variants: unknown[]; images: unknown[] }) =>
    api.patch<Product>(`/api/partner/products/${id}`, payload),
  remove: (id: string) => api.delete<{ message: string }>(`/api/partner/products/${id}`),

  // ─── Duplicates ─────────────────────────────────────
  listDuplicates() {
    return api.get<PartnerProductDuplicatesResponse>('/api/partner/products/duplicates');
  },
  resolveDuplicates(payload: { groups: Array<{ keep_id: string; remove_ids: string[] }> }) {
    return api.post<PartnerResolveDuplicatesResult>('/api/partner/products/duplicates/resolve', payload);
  },
  // ─── Import duplicates ──────────────────────────────
  listImportDuplicates(status: PartnerImportDuplicateStatus | 'all' = 'pending') {
    return api.get<PartnerProductImportDuplicatesResponse>(
      '/api/partner/products/import-duplicates', { status },
    );
  },
  createFromImportDuplicate(id: string) {
    return api.post<{ id: string; name_es: string; created: boolean }>(
      `/api/partner/products/import-duplicates/${id}/create`, {},
    );
  },
  dismissImportDuplicate(id: string) {
    return api.post<{ id: string; dismissed: boolean }>(
      `/api/partner/products/import-duplicates/${id}/dismiss`, {},
    );
  },
  dismissAllImportDuplicates(ids?: string[]) {
    return api.post<{ dismissed: number }>(
      '/api/partner/products/import-duplicates/dismiss-all', ids ? { ids } : {},
    );
  },

  mergeDuplicates(payload: { groups: Array<{ keep_id: string; remove_ids: string[] }> }) {
    return api.post<PartnerMergeDuplicatesResult>('/api/partner/products/duplicates/merge', payload);
  },

  // ─── Bulk import — enqueue + poll ───────────────────
  async importFromXlsx(file: File): Promise<PartnerImportJobEnqueueResult> {
    const form = new FormData();
    form.append('file', file);

    // Content-hash idempotency key — a same-file resubmit within the
    // server's replay window returns the ORIGINAL job's id instead of
    // running a second import. Same shape as admin's importer.
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

    return api.post<PartnerImportJobEnqueueResult>('/api/partner/products/import', form, {
      multipart: true,
      timeoutMs: 30_000,
      headers: { 'Idempotency-Key': idempotencyKey },
    });
  },

  getImportJob(jobId: string): Promise<PartnerImportJob> {
    return api.get<PartnerImportJob>(`/api/partner/products/import/jobs/${jobId}`);
  },

  listImportJobs(limit = 10): Promise<PartnerImportJob[]> {
    return api.get<PartnerImportJob[]>('/api/partner/products/import/jobs', { limit });
  },

  /**
   * Kick off a browser download of the partner import template xlsx.
   * Skips the JSON helpers because the endpoint streams a binary body.
   */
  async downloadTemplate(): Promise<void> {
    const baseUrl = getApiBaseUrl();
    const token = await getTokenStorage().getAccessToken();
    const res = await fetch(`${baseUrl}/api/partner/products/import/template`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`Template download failed (${res.status})`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'partner-products-import-template.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};

export const partnerRiders = {
  list: (params: { activeOnly?: boolean } = {}) =>
    api.get<Array<Rider & { _count: { orders: number } }>>(
      '/api/partner/riders',
      params.activeOnly ? { activeOnly: 'true' } : undefined,
    ),
  create: (payload: PartnerRiderPayload) => api.post<Rider>('/api/partner/riders', payload),
  update: (id: string, payload: PartnerRiderPayload) => api.put<Rider>(`/api/partner/riders/${id}`, payload),
  remove: (id: string) => api.delete<{ message: string }>(`/api/partner/riders/${id}`),
};

// ─── Taxonomy (partner-scoped mirror of the public read endpoints) ──

export interface PartnerCategory {
  id: string;
  name_es: string;
  name_en: string;
  icon_url: string | null;
  sort_order: number;
  is_active: boolean;
}

export interface PartnerSubcategory {
  id: string;
  category_id: string;
  name_es: string;
  name_en: string;
  sort_order: number;
  is_active: boolean;
}

export interface PartnerProductType {
  id: string;
  subcategory_id: string;
  name_es: string;
  name_en: string;
  sort_order: number;
  is_active: boolean;
}

export interface PartnerBrand {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  logo_bg: string | null;
  sort_order: number;
  is_active: boolean;
}

export interface PartnerOrigin {
  id: string;
  key: string;
  label_es: string;
  label_en: string;
  bg_color: string | null;
  accent_color: string | null;
  image_url: string | null;
  sort_order: number;
  is_active: boolean;
}

/** Payload for submitting a new category for admin review. store_id/user_id
 *  are forced server-side from the JWT — never send them from the client. */
export interface PartnerCategorySubmissionPayload {
  name_es: string;
  name_en: string;
  icon_url?: string | null;
  bg_color?: string | null;
  accent_color?: string | null;
}

export const partnerTaxonomy = {
  categories:    () => api.get<PartnerCategory[]>('/api/partner/taxonomy/categories'),
  subcategories: (categoryId?: string) =>
    api.get<PartnerSubcategory[]>('/api/partner/taxonomy/subcategories', categoryId ? { categoryId } : undefined),
  productTypes:  (subcategoryId: string) =>
    api.get<PartnerProductType[]>('/api/partner/taxonomy/product-types', { subcategoryId }),
  brands:  () => api.get<PartnerBrand[]>('/api/partner/taxonomy/brands'),
  origins: () => api.get<PartnerOrigin[]>('/api/partner/taxonomy/origins'),
  // Categories are the one taxonomy type a partner may propose — see Ground
  // Rule 9 carve-out in docs/MULTIVENDOR_ROADMAP.md. Submissions start
  // pending and are invisible everywhere until an admin approves them.
  createCategory: (payload: PartnerCategorySubmissionPayload) =>
    api.post<PartnerCategorySubmission>('/api/partner/taxonomy/categories', payload),
  myCategories: () =>
    api.get<PartnerCategorySubmission[]>('/api/partner/taxonomy/categories/mine'),
  // Clears a submission from "my categories" (read-state only — the
  // Category itself, once approved, stays live regardless).
  dismissCategorySubmission: (id: string) =>
    api.post<{ message: string }>(`/api/partner/taxonomy/categories/${id}/dismiss`),
};

// ─── Uploads (partner-scoped) ────────────────────────────

export interface PartnerUploadResult {
  url: string;
  filename: string;
  size: number;
  mimeType: string;
}

export const partnerUploads = {
  /** Upload a product image. Multipart POST — the api client wraps FormData. */
  uploadImage(file: File): Promise<PartnerUploadResult> {
    const fd = new FormData();
    fd.append('file', file);
    return api.post<PartnerUploadResult>('/api/partner/uploads/image', fd, { multipart: true });
  },
};

export const partnerOrders = {
  list: (params: PartnerOrdersListParams = {}) =>
    api.get<Array<Order & { _count: { items: number } }>>(
      '/api/partner/orders',
      params as Record<string, string | number | boolean | undefined | null>,
    ),
  get:          (id: string) => api.get<Order>(`/api/partner/orders/${id}`),
  updateStatus: (id: string, status: PartnerOrderStatusTarget) =>
    api.put<Order>(`/api/partner/orders/${id}/status`, { status }),
  assignRider:  (id: string, riderId: string | null) =>
    api.put<Order>(`/api/partner/orders/${id}/rider`, { riderId }),
  // Partner-initiated cancel. Reason is required server-side (min 5 chars)
  // — that gate is duplicated in the UI so users see the constraint before
  // the network round-trip.
  cancel:       (id: string, reason: string) =>
    api.post<Order>(`/api/partner/orders/${id}/cancel`, { reason }),
  // Resolves a `draft` order: re-checks stock, decrements it, and moves the
  // order to `pending`. Separate from updateStatus — see the API route.
  confirmStock: (id: string) =>
    api.post<Order>(`/api/partner/orders/${id}/confirm-stock`, {}),
  // Edit line items (quantity change / replace / remove / add) on an order
  // still in this store's control (pending/confirmed/preparing).
  /**
   * 30s, not the 10s default.
   *
   * The server's edit transaction is budgeted at 8s (lib/editOrder.ts) and the
   * client must outlast it, or the browser hangs up on a transaction that may
   * still commit — the customer is told it failed while the edit lands. The
   * wide margin also means the server budget can be raised later without
   * having to redeploy both apps in lockstep to stay safe.
   */
  editItems: (id: string, payload: EditOrderRequest) =>
    api.put<EditOrderResponse>(`/api/partner/orders/${id}/items`, payload, { timeoutMs: 30_000 }),
  /**
   * Price this order's delivery. The shop holds the parcel, so the shop
   * decides what carrying it is worth — it is a judgement about weight and
   * bulk, not a consequence of the items.
   *
   * Open to owner AND manager. Refused outside pending/confirmed/preparing,
   * once an invoice has been issued, and on one part of a split purchase,
   * where the fee belongs to the whole purchase rather than this part.
   */
  setDeliveryFee: (id: string, deliveryFee: number) =>
    api.put<{ id: string; subtotal: number; delivery_fee: number; total: number }>(
      `/api/partner/orders/${id}/delivery-fee`,
      { delivery_fee: deliveryFee },
    ),
};
