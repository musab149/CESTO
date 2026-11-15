import { api } from '../client';
import type { BusinessHomeContent } from '../../businessHome';

/* ─── The business panel ───────────────────────────────── */

export const businessHomeService = {
  /** Only what is live: promotions that are on, announcements not yet past. */
  get() {
    return api.get<BusinessHomeContent>('/api/business/home');
  },
};

/* ─── Admin ────────────────────────────────────────────── */

export const adminBusinessHome = {
  get() {
    return api.get<BusinessHomeContent>('/api/admin/business-home');
  },
  /** Whole-object save; partial writes are not supported on purpose. */
  update(content: BusinessHomeContent) {
    return api.put<BusinessHomeContent>('/api/admin/business-home', content);
  },
  /** Back to the shipped copy. super_admin only, enforced server-side. */
  reset() {
    return api.post<BusinessHomeContent>('/api/admin/business-home/reset', {});
  },
};
