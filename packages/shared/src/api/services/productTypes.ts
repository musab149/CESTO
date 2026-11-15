import { api } from '../client';

// ─── Types ──────────────────────────────────────────────

export interface ProductType {
  id: string;
  subcategory_id: string;
  name_es: string;
  name_en: string;
  sort_order: number;
  is_active: boolean;
  /** 'manual' | 'import' — set by the Excel importer to flag rows it
   *  auto-created as suggestions. Only carries a value on admin responses. */
  source?: 'manual' | 'import';
  created_at?: string;
  updated_at?: string;
  /** Present on admin GET/list responses only. */
  subcategory?: { id: string; name_es: string; name_en: string; category_id: string };
  _count?: { products: number };
}

export interface CreateProductTypePayload {
  subcategory_id: string;
  name_es: string;
  name_en: string;
  sort_order?: number;
  is_active?: boolean;
}

// Update: subcategory_id is intentionally not included — the parent
// subcategory is immutable once created (moving a product type between
// subcategories would silently orphan its products).
export interface UpdateProductTypePayload {
  name_es?: string;
  name_en?: string;
  sort_order?: number;
  is_active?: boolean;
}

export interface AdminProductTypesListParams {
  subcategoryId?: string;
  categoryId?: string;
  isActive?: 'true' | 'false';
  source?: 'manual' | 'import';
}

// ─── Public service ─────────────────────────────────────
// Read-only surface for cascading pickers on the storefront + admin product
// form. Both use the same shape — subcategoryId is the primary filter.

export const productTypesService = {
  listForSubcategory(subcategoryId: string): Promise<ProductType[]> {
    return api.get<ProductType[]>(`/api/product-types?subcategoryId=${encodeURIComponent(subcategoryId)}`);
  },
  listForCategory(categoryId: string): Promise<ProductType[]> {
    return api.get<ProductType[]>(`/api/product-types?categoryId=${encodeURIComponent(categoryId)}`);
  },
};

// ─── Admin service ──────────────────────────────────────

export const adminProductTypes = {
  list(params: AdminProductTypesListParams = {}): Promise<ProductType[]> {
    const qs = new URLSearchParams();
    if (params.subcategoryId) qs.set('subcategoryId', params.subcategoryId);
    if (params.categoryId)    qs.set('categoryId', params.categoryId);
    if (params.isActive)      qs.set('isActive', params.isActive);
    if (params.source)        qs.set('source', params.source);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return api.get<ProductType[]>(`/api/admin/product-types${suffix}`);
  },
  get(id: string): Promise<ProductType> {
    return api.get<ProductType>(`/api/admin/product-types/${id}`);
  },
  create(payload: CreateProductTypePayload): Promise<ProductType> {
    return api.post<ProductType>('/api/admin/product-types', payload);
  },
  update(id: string, payload: UpdateProductTypePayload): Promise<ProductType> {
    return api.put<ProductType>(`/api/admin/product-types/${id}`, payload);
  },
  remove(id: string): Promise<{ message: string; detached: number }> {
    return api.delete<{ message: string; detached: number }>(`/api/admin/product-types/${id}`);
  },
  reorder(ids: string[]): Promise<{ reordered: number }> {
    return api.post<{ reordered: number }>('/api/admin/product-types/reorder', { ids });
  },
};
