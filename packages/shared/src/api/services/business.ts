import { api } from '../client';
import type { ShopHours } from '../../types';
import type { VatCategory } from '../../tax';
import type { Paged } from './sales';

/**
 * The business panel's API surface — `/api/business/*` (2026-10-29).
 *
 * Every call goes through `requireBusiness()` on the server: the ordinary
 * customer token, and an account an admin approved as a business. Only what
 * the customer routes cannot answer lives here — the catalogue as a business
 * sees it (only products with a wholesale price, priced as checkout charges)
 * and the dashboard's summary. Their cart, checkout, orders and addresses are
 * the customer hooks (useCart, useCheckout, useOrders…), which already price a
 * business at wholesale.
 */

/** Money as the API sends it: a Decimal is a string on the wire. */
type Money = string | number;

// ─── /me ────────────────────────────────────────────────

export interface BusinessProfileInfo {
  company: string;
  business_type: string | null;
  location: string | null;
  website: string | null;
  registration_no: string | null;
  contact_phone: string | null;
  approved_at: string;
}

export interface BusinessMe {
  user: { name: string; email: string | null; phone: string | null; tax_id: string | null; created_at: string | null };
  business: BusinessProfileInfo | null;
  stats: {
    this_month: { orders: number; spent: Money };
    all_time: { orders: number; spent: Money };
    /** Pending, confirmed, preparing or on the way. */
    in_progress: number;
    delivered: number;
  };
  /** How many products it can buy at wholesale. */
  catalogue: { products: number };
}

export const businessMe = {
  get: () => api.get<BusinessMe>('/api/business/me'),
};

// ─── The catalogue ──────────────────────────────────────

/** A size with a wholesale price. `price` is what they pay — wholesale, less
 *  any price agreed with them. A business is never sent the retail price. */
export interface BusinessSize {
  id: string;
  name_es: string;
  name_en: string | null;
  sku: string | null;
  is_default: boolean;
  price: Money;
  b2b_price?: Money | null;
  /** Set only when a price agreed with them came off: what it came off. */
  compare_at_price: Money | null;
  customer_discount?: Money | null;
  stock_quantity: number;
  low_stock_threshold: number | null;
}

export interface BusinessProduct {
  id: string;
  name_es: string;
  name_en: string | null;
  brand: string | null;
  brand_id: string | null;
  origin: string | null;
  origin_id: string | null;
  /** Null: Cesto's own catalogue. */
  store_id: string | null;
  category_id: string;
  subcategory_id: string | null;
  is_new_arrival: boolean;
  is_top_seller: boolean;
  is_quotation_enabled: boolean;
  rating: Money | null;
  rating_count: number;
  created_at: string;
  /** Absent from an API before 2026-10-30. */
  vat_category?: VatCategory;
  /** Whether somebody chose that band; until then the prices carry 0 %. Absent on an older API. */
  vat_category_reviewed?: boolean;
  category: { id: string; name_es: string; name_en: string | null } | null;
  store: { id: string; slug: string; name: string; logo_url: string | null; logo_bg: string | null } | null;
  brand_ref: { id: string; name: string; slug: string; logo_url: string | null; logo_bg: string | null } | null;
  origin_ref: { id: string; key: string; label_es: string; label_en: string | null } | null;
  variants: BusinessSize[];
  images: { url: string }[];
}

export interface BusinessProductDetail extends Omit<BusinessProduct, 'images'> {
  description_es: string | null;
  description_en: string | null;
  images: { url: string; is_primary: boolean; sort_order: number }[];
}

export interface BusinessProductsParams {
  q?: string;
  categoryId?: string;
  subcategoryId?: string;
  /** 'cesto' is Cesto's own catalogue. */
  storeId?: string;
  brandId?: string;
  originId?: string;
  stock?: 'in';
  sort?: 'newest' | 'name_asc' | 'name_desc';
  page?: number;
  limit?: number;
}

export interface BusinessCategory {
  id: string;
  name_es: string;
  name_en: string | null;
  icon_url: string | null;
  bg_color: string | null;
  accent_color: string | null;
  sort_order: number;
  products: number;
}

export interface BusinessBrand {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  logo_bg: string | null;
  sort_order: number;
  products: number;
}

export interface BusinessOrigin {
  id: string;
  key: string;
  label_es: string;
  label_en: string | null;
  bg_color: string | null;
  accent_color: string | null;
  image_url: string | null;
  sort_order: number;
  products: number;
}

export interface BusinessStore {
  id: string;
  slug: string;
  name: string;
  logo_url: string | null;
  logo_bg: string | null;
  is_verified: boolean;
  cover_url: string | null;
  tagline_es: string | null;
  tagline_en: string | null;
  shop_hours: ShopHours | null;
  products: number;
}

export interface BusinessStoresResponse {
  items: BusinessStore[];
  /** Cesto's own catalogue, which has no shop row. */
  house: { products: number };
}

export const businessCatalogue = {
  products: (params: BusinessProductsParams = {}) => api.get<Paged<BusinessProduct>>(
    '/api/business/catalogue/products',
    params as Record<string, string | number | boolean | undefined | null>,
    { timeoutMs: 30_000 },
  ),
  product: (id: string) => api.get<BusinessProductDetail>(`/api/business/catalogue/products/${id}`),
  categories: () => api.get<BusinessCategory[]>('/api/business/catalogue/categories'),
  brands: () => api.get<BusinessBrand[]>('/api/business/catalogue/brands'),
  origins: () => api.get<BusinessOrigin[]>('/api/business/catalogue/origins'),
  stores: () => api.get<BusinessStoresResponse>('/api/business/catalogue/stores'),
  /** The home's "new in your catalogue" rail: the shop's new-arrivals pick, over the business catalogue. */
  newArrivals: (limit = 12) => api.get<BusinessProduct[]>('/api/business/catalogue/new', { limit }),
  /** The home's "what you order most": their most-ordered products of the last 120 days still on sale here. */
  usuals: (limit = 12) => api.get<BusinessProduct[]>('/api/business/catalogue/usuals', { limit }),
};
