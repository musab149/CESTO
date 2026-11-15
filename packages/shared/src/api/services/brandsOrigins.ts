import { api } from '../client';

// ─── Types ──────────────────────────────────────────────

/** Where a brand/origin row came from. 'import' rows are Excel-importer
 *  auto-creates awaiting admin review; 'manual' rows were added via the UI. */
export type BrandOriginSource = 'manual' | 'import';

export interface Brand {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  logo_bg: string | null;
  link: string | null;
  is_active: boolean;
  sort_order: number;
  source: BrandOriginSource;
  created_at: string;
  updated_at: string;
  /** Admin list only. */
  _count?: { products: number };
}

export interface Origin {
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
  source: BrandOriginSource;
  created_at: string;
  updated_at: string;
  _count?: { products: number };
}

export interface BrandWritePayload {
  name: string;
  slug?: string;
  logo_url?: string | null;
  logo_bg?: string | null;
  link?: string | null;
  is_active?: boolean;
  sort_order?: number;
}

export interface OriginWritePayload {
  key?: string;
  label_es: string;
  label_en: string;
  bg_color?: string | null;
  accent_color?: string | null;
  image_url?: string | null;
  link?: string | null;
  is_active?: boolean;
  sort_order?: number;
}

// ─── Public (customer-facing) ───────────────────────────

export const brandsService = {
  list()          { return api.get<Brand[]>('/api/brands'); },
  get(slug: string) { return api.get<Brand>(`/api/brands/${slug}`); },
};

export const originsService = {
  list()         { return api.get<Origin[]>('/api/origins'); },
  get(key: string) { return api.get<Origin>(`/api/origins/${key}`); },
};

// ─── Admin CRUD ─────────────────────────────────────────

export const adminBrands = {
  list()                                    { return api.get<Brand[]>('/api/admin/brands'); },
  get(id: string)                           { return api.get<Brand>(`/api/admin/brands/${id}`); },
  create(payload: BrandWritePayload)        { return api.post<Brand>('/api/admin/brands', payload); },
  update(id: string, payload: Partial<BrandWritePayload>) {
    return api.put<Brand>(`/api/admin/brands/${id}`, payload);
  },
  remove(id: string)                        { return api.delete<{ deleted: true; product_count: number }>(`/api/admin/brands/${id}`); },
  reorder(ids: string[])                    { return api.post<{ reordered: number }>('/api/admin/brands/reorder', { ids }); },
};

export const adminOrigins = {
  list()                                    { return api.get<Origin[]>('/api/admin/origins'); },
  get(id: string)                           { return api.get<Origin>(`/api/admin/origins/${id}`); },
  create(payload: OriginWritePayload)       { return api.post<Origin>('/api/admin/origins', payload); },
  update(id: string, payload: Partial<OriginWritePayload>) {
    return api.put<Origin>(`/api/admin/origins/${id}`, payload);
  },
  remove(id: string)                        { return api.delete<{ deleted: true; product_count: number }>(`/api/admin/origins/${id}`); },
  reorder(ids: string[])                    { return api.post<{ reordered: number }>('/api/admin/origins/reorder', { ids }); },
};
