import { api } from '../client';
import type { Store, StoreDetail, Product, ShopHours } from '../../types';
import type { RashanPack } from './rashan';
import type { AdminResendCredentialsResult } from './admin';

export interface StoresListParams {
  q?: string;
  origin?: string;
  minRating?: number;
  sort?: 'popular' | 'rating' | 'newest' | 'name';
  page?: number;
  limit?: number;
}

export interface StoreProductsParams {
  q?: string;
  categoryId?: string;
  /** Nested filter — only meaningful when categoryId is also set. Matches the
   *  same subcategory-drill-down pattern the /categories page uses. */
  subcategoryId?: string;
  /** Third-tier filter — only meaningful when subcategoryId is also set. */
  productTypeId?: string;
  /** Canonical Brand UUID. Orthogonal to the category drill-down — composes
   *  with it rather than resetting it. Matches store.brand_counts[].brand_id. */
  brandId?: string;
  tab?: 'all' | 'offers' | 'best-sellers' | 'new-arrivals' | 'featured';
  sort?: 'popular' | 'price_asc' | 'price_desc' | 'newest' | 'name_asc';
  page?: number;
  limit?: number;
}

/** One subcategory a store carries within a category, with a count of the
 *  store's active products in it. Shape is a lean subset of SubCategory —
 *  just what the storefront drill-down pills render. */
export interface StoreSubcategoryCount {
  id: string;
  name_es: string;
  name_en: string;
  sort_order: number;
  count: number;
}

/** One product type a store carries within a subcategory. */
export interface StoreProductTypeCount {
  id: string;
  subcategory_id: string;
  name_es: string;
  name_en: string;
  sort_order: number;
  count: number;
}

export interface AdminStoresListParams {
  q?: string;
  isActive?: 'true' | 'false';
  /** Filter by row provenance — 'manual' rows were admin-created, 'import'
   *  rows were auto-created by the Excel importer as suggestions. Combined
   *  with `isActive: 'false'` this yields the Suggestions filter. */
  source?: 'manual' | 'import';
  /** Soft-delete filter. Omit to see live + pending (tombstones hidden).
   *  'pending' = grace-window rows only; 'deleted' = tombstone archive. */
  deletionState?: 'live' | 'pending' | 'deleted';
  page?: number;
  limit?: number;
}

export interface ScheduleStoreDeletionPayload {
  confirmation_name: string;
  reason: string;
}

export interface PermanentDeleteStorePayload {
  confirmation_name: string;
}

export interface StoreWritePayload {
  slug?: string;
  name: string;
  tagline_es?: string | null;
  tagline_en?: string | null;
  description_es?: string | null;
  description_en?: string | null;
  logo_url?: string | null;
  logo_bg?: string;
  cover_url?: string | null;
  rating?: number | null;
  rating_count?: number;
  is_active?: boolean;
  is_verified?: boolean;
  fast_delivery?: boolean;
  /** Market the store trades in, ISO 3166-1 alpha-2. Drives the customer
   *  country filter. Not `origin`, which is the cuisine it sells. */
  country?: string;
  /** Where the shop physically trades, one free-text line. Shown on the
   *  storefront beside the country. Purely descriptive: nothing filters,
   *  routes or prices on it, and it does not limit where the store
   *  delivers. */
  address?: string | null;
  origin?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  website_url?: string | null;
  shop_hours?: ShopHours | null;
  sort_order?: number;
  /** MV Slice 0/1 lifecycle. Admin-controlled: 'draft' hides from customers,
   *  'live' publishes, 'suspended' also blocks partner login. Omitted on
   *  create defers to the schema default ('live'). Partner CRUD deliberately
   *  cannot set this field. */
  status?: 'draft' | 'live' | 'paused' | 'suspended';
  /** MV test-data flag. Legacy partner-approved stores (pre-6cdba65) landed
   *  with is_test=true — customerVisibleStoreFilter excludes those, so admin
   *  needs a UI path to flip it off once verified as production data. */
  is_test?: boolean;
}


/**
 * A store a partner application may be linked to: created by Cesto admin,
 * with no partner attached, not deleted or scheduled for deletion.
 *
 * The counts are not decoration — linking hands the partner everything already
 * on the store, so the admin should see what that is before committing.
 */
export interface LinkableStore {
  id: string;
  slug: string;
  name: string;
  status: string;
  is_active: boolean;
  logo_url: string | null;
  origin: string | null;
  created_at: string;
  _count: { products: number; orders: number };
}

export interface LinkableStoresResponse {
  items: LinkableStore[];
  total: number;
}

export interface UnlinkPartnerResult {
  store_id: string;
  store_name: string;
  unlinked: Array<{ user_id: string; name: string | null; email: string | null }>;
  /** False when the store was created by an approval — it does not go back
   *  into the pool, because it was never unclaimed inventory. */
  returned_to_link_pool: boolean;
}

/** How somebody signs in: nothing yet, a temporary password not yet replaced, or one of their own. */
export type AdminAccountAccess = 'none' | 'temporary' | 'own';

/** Somebody who manages a store (2026-10-31): the store page's Partner tab. */
export interface AdminStorePartner {
  user_id: string;
  name: string;
  email: string | null;
  status: 'active' | 'blocked';
  role: 'owner' | 'manager';
  /** A switched-off role still counts as the store's partner: unlink before giving it to anybody else. */
  is_active: boolean;
  linked_at: string;
  access: AdminAccountAccess;
}

/** Who manages a store, as the stores list shows it. */
export interface AdminStorePartnerSummary {
  user_id: string;
  name: string;
  email: string | null;
  is_active: boolean;
}

/**
 * Give somebody a store (POST /api/admin/partners): a person by email — an
 * account that exists, or a new one (then `name` is needed) — and exactly one
 * of an existing store with no partner or a new one to create for them.
 */
export interface AdminLinkPartnerPayload {
  user: { name: string; email: string };
  store_id?: string;
  store?: { name: string; contact_email?: string | null; contact_phone?: string | null };
  send_email: boolean;
}

export interface AdminLinkPartnerResult {
  store_id: string;
  store_name: string;
  store_status: string;
  store_created: boolean;
  user_id: string;
  user_created: boolean;
  /** `kept` — a password of their own stands, and none is handed back. */
  password: 'issued' | 'kept';
  login_email: string;
  temp_password: string | null;
  email_sent: boolean;
  reason: string | null;
}

export const storesService = {
  // ─── Public ─────────────────────────────────────────────
  list(params: StoresListParams = {}) {
    return api.get<{ items: Store[]; total: number; page: number; totalPages: number }>(
      '/api/stores',
      { ...params },
    );
  },
  getBySlug(slug: string) {
    return api.get<StoreDetail>(`/api/stores/${slug}`);
  },
  listProducts(slug: string, params: StoreProductsParams = {}) {
    return api.get<{ products: Product[]; total: number; page: number; totalPages: number }>(
      `/api/stores/${slug}/products`,
      { ...params },
    );
  },
  /** Rashan packs this store sells — feeds the storefront's Rashan tab.
   *  Its own call rather than a `tab=` on listProducts, because packs are not
   *  products and don't fit that paginated envelope. */
  listRashanPacks(slug: string) {
    return api.get<RashanPack[]>(`/api/stores/${slug}/rashan-packs`);
  },
  /** Subcategories this store carries within a category — the storefront
   *  drill-down must not offer taxonomy the store has no products in. */
  listSubcategories(slug: string, categoryId: string) {
    return api.get<StoreSubcategoryCount[]>(`/api/stores/${slug}/subcategories`, { categoryId });
  },
  /** Product types this store carries within a subcategory. */
  listProductTypes(slug: string, subcategoryId: string) {
    return api.get<StoreProductTypeCount[]>(`/api/stores/${slug}/product-types`, { subcategoryId });
  },
  follow(slug: string) {
    return api.post<{ followers_count: number; is_followed: true }>(`/api/stores/${slug}/follow`);
  },
  unfollow(slug: string) {
    return api.delete<{ followers_count: number; is_followed: false }>(`/api/stores/${slug}/follow`);
  },
  myFollowedStores() {
    return api.get<Store[]>('/api/users/me/followed-stores');
  },

  // ─── Admin ──────────────────────────────────────────────
  admin: {
    /** Stores eligible to be linked to a partner application. */
    linkable() {
      return api.get<LinkableStoresResponse>('/api/admin/stores/linkable');
    },
    /** Detach every partner from a store. super_admin only. */
    unlinkPartner(id: string) {
      return api.post<UnlinkPartnerResult>(`/api/admin/stores/${id}/unlink-partner`, {});
    },
    /** Give somebody a store — they become its partner. */
    linkPartner(payload: AdminLinkPartnerPayload) {
      return api.post<AdminLinkPartnerResult>('/api/admin/partners', payload);
    },
    /** A partner's login again: a new temporary password, mailed or shown. */
    partnerCredentials(userId: string, sendEmail: boolean) {
      return api.post<AdminResendCredentialsResult>(`/api/admin/partners/${userId}/credentials`, { send_email: sendEmail });
    },
    list(params: AdminStoresListParams = {}) {
      // `partners` is optional: an API from before 2026-10-31 does not send it.
      return api.get<{ items: (Store & { _count: { products: number; sales_reps?: number }; partners?: AdminStorePartnerSummary[] })[]; total: number; page: number; totalPages: number }>(
        '/api/admin/stores',
        { ...params },
      );
    },
    get(id: string) {
      // `partners` is optional: an API from before 2026-10-31 does not send it.
      return api.get<Store & { _count: { products: number; sales_reps?: number }; product_ids: string[]; partners?: AdminStorePartner[] }>(`/api/admin/stores/${id}`);
    },
    create(payload: StoreWritePayload) {
      return api.post<Store>('/api/admin/stores', payload);
    },
    update(id: string, payload: StoreWritePayload) {
      return api.patch<Store>(`/api/admin/stores/${id}`, payload);
    },
    /**
     * @deprecated Direct delete is disabled — the endpoint returns 410 Gone.
     * Use `scheduleDeletion` → wait 5 days → `permanentDelete` instead.
     * Kept only so a stale admin bundle mid-deploy gets a legible error
     * (per feedback_deploy-shape-skew).
     */
    remove(id: string) {
      return api.delete<{ message: string }>(`/api/admin/stores/${id}`);
    },
    scheduleDeletion(id: string, payload: ScheduleStoreDeletionPayload) {
      return api.post<{ message: string; grace_days: number }>(
        `/api/admin/stores/${id}/schedule-deletion`,
        payload,
      );
    },
    cancelDeletion(id: string) {
      return api.post<{ message: string }>(`/api/admin/stores/${id}/cancel-deletion`);
    },
    permanentDelete(id: string, payload: PermanentDeleteStorePayload) {
      return api.post<{ message: string }>(
        `/api/admin/stores/${id}/permanent-delete`,
        payload,
      );
    },
    restore(id: string) {
      return api.post<{ message: string }>(`/api/admin/stores/${id}/restore`);
    },
    assignProducts(id: string, productIds: string[]) {
      return api.post<{ assigned: number }>(`/api/admin/stores/${id}/products`, { product_ids: productIds });
    },
    unassignProducts(id: string, productIds: string[]) {
      return api.delete<{ unassigned: number }>(`/api/admin/stores/${id}/products?ids=${productIds.join(',')}`);
    },
  },
};
