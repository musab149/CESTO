import { api } from '../client';
import type { AppContent } from '../../appContent';

/* ─── Public ───────────────────────────────────────────── */

export const appContentService = {
  /** Never 404s and never partial — the server fills gaps from its defaults. */
  get() {
    return api.get<AppContent>('/api/app-content');
  },
};

/* ─── Admin ────────────────────────────────────────────── */

export const adminAppContent = {
  get() {
    return api.get<AppContent>('/api/admin/app-content');
  },
  /** Whole-object save; partial writes are not supported on purpose. */
  update(content: AppContent) {
    return api.put<AppContent>('/api/admin/app-content', content);
  },
  /** Back to the shipped copy. super_admin only, enforced server-side. */
  reset() {
    return api.post<AppContent>('/api/admin/app-content/reset', {});
  },
};
