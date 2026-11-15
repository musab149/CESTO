import { api } from '../client';
import type { Product, Category, SubCategory, Banner } from '../../types';

/** What GET /api/products/by-ids accepts in one request (see routes/products.ts). */
const BY_IDS_BATCH = 100;

export interface PageResult<T> {
  items?: T[];
  products?: T[];
  total: number;
  page: number;
  totalPages: number;
}

export interface ListProductsParams {
  subcat?: string;
  /** Third-tier taxonomy filter. Only applied when `subcat` is also set. */
  productType?: string;
  sort?: 'price_asc' | 'price_desc' | 'name_asc';
  page?: number;
  limit?: number;
}

export interface ListAllProductsParams {
  /** Free text, matched against name_es / name_en / brand. */
  q?: string;
  categoryId?: string;
  subcategoryId?: string;
  productTypeId?: string;
  /**
   * Store id, or the literal `'cesto'` for the house catalogue — those
   * products have `store_id = null`, so there is no id to pass.
   */
  storeId?: string;
  origin?: string;
  brand?: string;
  sponsored?: boolean | '1';
  /** Admin-curated home "New products" rail. */
  newArrival?: boolean | '1';
  sort?: 'name_asc' | 'newest' | 'popular';
  page?: number;
  limit?: number;
}

export const catalogService = {
  listProducts(params: ListAllProductsParams = {}) {
    return api.get<{ items: Product[]; total: number; page: number; limit: number; totalPages: number }>(
      '/api/products',
      { ...params },
    );
  },

  listCategories() {
    return api.get<(Category & { _count: { subcategories: number; products: number } })[]>('/api/categories');
  },

  listSubcategories(categoryId: string) {
    return api.get<SubCategory[]>(`/api/categories/${categoryId}/subcategories`);
  },

  listCategoryProducts(categoryId: string, params: ListProductsParams = {}) {
    return api.get<{ products: Product[]; total: number; page: number; totalPages: number }>(
      `/api/categories/${categoryId}/products`,
      { ...params },
    );
  },

  getProduct(id: string) {
    return api.get<Product>(`/api/products/${id}`);
  },

  /**
   * "You might also like". Tiered server-side: the same product from another
   * shop first, then the nearest taxonomy — `related_reason` says which rule
   * matched, so the UI can label a row if it wants to.
   */
  relatedProducts(id: string, limit = 12) {
    return api.get<{ items: Array<Product & { related_reason: string }> }>(
      `/api/products/${id}/related`,
      { limit },
    );
  },

  /**
   * Products by id, in the caller's order (the server preserves it).
   *
   * The endpoint takes at most 100 ids, and a basket can hold up to
   * MAX_ORDER_LINES, so a longer list goes out in batches of 100 side by side
   * and is stitched back together in order. Every caller used to slice its
   * list to 100 instead, which left a 600-line basket showing 500 lines with
   * no name, no picture and €0.00.
   */
  async productsByIds(ids: string[]) {
    const fetchBatch = (batch: string[]) =>
      api.get<Product[]>('/api/products/by-ids', { ids: batch.join(',') });
    if (ids.length <= BY_IDS_BATCH) return fetchBatch(ids);
    const batches: string[][] = [];
    for (let i = 0; i < ids.length; i += BY_IDS_BATCH) batches.push(ids.slice(i, i + BY_IDS_BATCH));
    return (await Promise.all(batches.map(fetchBatch))).flat();
  },

  featuredProducts(limit = 10) {
    return api.get<Product[]>('/api/products/featured', { limit });
  },

  sponsoredProducts(limit = 10) {
    return api.get<Product[]>('/api/products/sponsored', { limit });
  },

  banners() {
    return api.get<Banner[]>('/api/banners');
  },

  searchSuggestions(q: string) {
    return api.get<Product[]>('/api/search/suggestions', { q });
  },

  search(q: string, params: ListProductsParams = {}) {
    return api.get<{ products: Product[]; total: number; page: number; totalPages: number }>(
      '/api/search',
      { q, ...params },
    );
  },
};
