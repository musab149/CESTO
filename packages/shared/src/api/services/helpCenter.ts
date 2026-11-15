import { api } from '../client';
import type { HelpCategory, HelpArticle } from '../../types';

/* ─── Public ───────────────────────────────────────────── */

export const helpCenterService = {
  /** Landing page — categories with their (id, slug, title) article summaries. */
  list() {
    return api.get<HelpCategory[]>('/api/help-center');
  },
  /** Article detail — includes the parent category + sibling article list. */
  getArticle(slug: string) {
    return api.get<HelpArticle>(`/api/help-center/articles/${slug}`);
  },
};

/* ─── Admin ────────────────────────────────────────────── */

export interface AdminHelpCategoryPayload {
  slug: string;
  title_en: string;
  title_es: string;
  icon?: string | null;
  sort_order?: number;
  is_active?: boolean;
}

export interface AdminHelpArticlePayload {
  category_id: string;
  slug: string;
  title_en: string;
  title_es: string;
  body_en?: string;
  body_es?: string;
  sort_order?: number;
  is_active?: boolean;
}

export const adminHelpCenter = {
  listCategories() {
    return api.get<HelpCategory[]>('/api/admin/help-center/categories');
  },
  createCategory(payload: AdminHelpCategoryPayload) {
    return api.post<HelpCategory>('/api/admin/help-center/categories', payload);
  },
  updateCategory(id: string, payload: AdminHelpCategoryPayload) {
    return api.put<HelpCategory>(`/api/admin/help-center/categories/${id}`, payload);
  },
  deleteCategory(id: string) {
    return api.delete<{ message: string }>(`/api/admin/help-center/categories/${id}`);
  },

  listArticles(params: { categoryId?: string } = {}) {
    return api.get<HelpArticle[]>('/api/admin/help-center/articles', params);
  },
  getArticle(id: string) {
    return api.get<HelpArticle>(`/api/admin/help-center/articles/${id}`);
  },
  createArticle(payload: AdminHelpArticlePayload) {
    return api.post<HelpArticle>('/api/admin/help-center/articles', payload);
  },
  updateArticle(id: string, payload: AdminHelpArticlePayload) {
    return api.put<HelpArticle>(`/api/admin/help-center/articles/${id}`, payload);
  },
  deleteArticle(id: string) {
    return api.delete<{ message: string }>(`/api/admin/help-center/articles/${id}`);
  },
};
