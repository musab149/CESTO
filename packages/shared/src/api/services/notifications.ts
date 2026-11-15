import { api } from '../client';

// ─── Types ──────────────────────────────────────────────
// Mirror the Prisma model — shapes match exactly so the row coming off
// the wire is the row stored in the DB.

export type NotificationAudience = 'customer' | 'admin' | 'partner' | 'sales_rep';

export type NotificationType =
  | 'order_confirmed'
  | 'order_preparing'
  | 'order_on_the_way'
  | 'order_delivered'
  | 'order_cancelled'
  | 'promo_banner'
  | 'admin_new_order'
  | 'admin_low_stock'
  | 'admin_new_customer'
  | 'admin_subscription_paused'
  | 'admin_broadcast'
  | 'admin_quotation_request'
  // Home Grocery request outcomes (customer) and new requests (admin bell).
  | 'home_grocery_approved'
  | 'home_grocery_rejected'
  | 'admin_home_grocery_request'
  // Our team built an order for this customer (staff or a sales rep).
  | 'order_placed'
  // A partner's own inbox — the bell on their dashboard.
  | 'partner_new_order'
  | 'partner_draft_order'
  | 'partner_order_edited'
  | 'partner_order_cancelled'
  // Home Grocery plans: the household's next delivery is planned / being
  // prepared, and (admin bell) a household started, paused or resumed its plan.
  | 'home_grocery_delivery_planned'
  | 'admin_home_grocery_plan'
  // A sales rep's own inbox (2026-10-26): their earnings published or paid,
  // an order they built delivered or cancelled by somebody else.
  | 'rep_statement_published'
  | 'rep_statement_paid'
  | 'rep_order_delivered'
  | 'rep_earning_approved'
  | 'rep_earning_reversed'
  | 'rep_earning_adjusted'
  | 'rep_payout_recorded'
  | 'rep_order_cancelled';

export interface AppNotification {
  id: string;
  audience: NotificationAudience;
  user_id: string | null;
  type: NotificationType;
  title_es: string;
  title_en: string;
  body_es: string;
  body_en: string;
  deeplink: string | null;
  read: boolean;
  read_at: string | null;
  data: Record<string, unknown> | null;
  created_at: string;
}

export interface NotificationListParams {
  page?: number;
  limit?: number;
  /** When true, drops read rows server-side. */
  unread?: boolean;
}

export interface NotificationListResponse {
  items: AppNotification[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface BroadcastPayload {
  title_es: string;
  title_en: string;
  body_es: string;
  body_en: string;
  deeplink?: string | null;
  segment?: 'all' | 'subscribers' | 'with_orders';
}

export interface BroadcastResult {
  recipients: number;
  persisted: number;
  segment: BroadcastPayload['segment'];
}

function listQuery(params: NotificationListParams): Record<string, string | number | undefined> {
  return {
    page:   params.page,
    limit:  params.limit,
    unread: params.unread ? '1' : undefined,
  };
}

// ─── Customer ───────────────────────────────────────────

export const notificationsService = {
  list(params: NotificationListParams = {}): Promise<NotificationListResponse> {
    return api.get<NotificationListResponse>('/api/notifications', listQuery(params));
  },
  unreadCount(): Promise<{ count: number }> {
    return api.get<{ count: number }>('/api/notifications/unread-count');
  },
  markRead(id: string): Promise<{ updated: number }> {
    return api.post<{ updated: number }>(`/api/notifications/${id}/read`);
  },
  markAllRead(): Promise<{ updated: number }> {
    return api.post<{ updated: number }>('/api/notifications/read-all');
  },
  remove(id: string): Promise<{ deleted: number }> {
    return api.delete<{ deleted: number }>(`/api/notifications/${id}`);
  },
  // ─── Web push ──────────────────────────────────────────
  vapidPublicKey(): Promise<{ publicKey: string }> {
    return api.get<{ publicKey: string }>('/api/notifications/vapid-public-key');
  },
  webSubscribe(payload: {
    endpoint: string;
    keys: { p256dh: string; auth: string };
    userAgent?: string;
  }): Promise<{ message: string }> {
    return api.post<{ message: string }>('/api/notifications/web-subscribe', payload);
  },
  webUnsubscribe(endpoint: string): Promise<{ deleted: number }> {
    return api.post<{ deleted: number }>('/api/notifications/web-unsubscribe', { endpoint });
  },
};

// ─── Partner ────────────────────────────────────────────
// The bell on the partner dashboard: their shop's orders, for the login
// that is signed in. Scoped to the shop server-side.

export const partnerNotifications = {
  list(params: NotificationListParams = {}): Promise<NotificationListResponse> {
    return api.get<NotificationListResponse>('/api/partner/notifications', listQuery(params));
  },
  unreadCount(): Promise<{ count: number }> {
    return api.get<{ count: number }>('/api/partner/notifications/unread-count');
  },
  markRead(id: string): Promise<{ updated: number }> {
    return api.post<{ updated: number }>(`/api/partner/notifications/${id}/read`);
  },
  markAllRead(): Promise<{ updated: number }> {
    return api.post<{ updated: number }>('/api/partner/notifications/read-all');
  },
};

// ─── Sales rep ──────────────────────────────────────────
// The bell in the rep panel (2026-10-26), for the signed-in rep.

export const salesNotifications = {
  list(params: NotificationListParams = {}): Promise<NotificationListResponse> {
    return api.get<NotificationListResponse>('/api/sales/notifications', listQuery(params));
  },
  unreadCount(): Promise<{ count: number }> {
    return api.get<{ count: number }>('/api/sales/notifications/unread-count');
  },
  markRead(id: string): Promise<{ updated: number }> {
    return api.post<{ updated: number }>(`/api/sales/notifications/${id}/read`);
  },
  markAllRead(): Promise<{ updated: number }> {
    return api.post<{ updated: number }>('/api/sales/notifications/read-all');
  },
};

// ─── Admin ──────────────────────────────────────────────

export const adminNotifications = {
  list(params: NotificationListParams = {}): Promise<NotificationListResponse> {
    return api.get<NotificationListResponse>('/api/admin/notifications', listQuery(params));
  },
  unreadCount(): Promise<{ count: number }> {
    return api.get<{ count: number }>('/api/admin/notifications/unread-count');
  },
  markRead(id: string): Promise<{ updated: number }> {
    return api.post<{ updated: number }>(`/api/admin/notifications/${id}/read`);
  },
  markAllRead(): Promise<{ updated: number }> {
    return api.post<{ updated: number }>('/api/admin/notifications/read-all');
  },
  broadcast(payload: BroadcastPayload): Promise<BroadcastResult> {
    return api.post<BroadcastResult>('/api/admin/notifications/broadcast', payload);
  },
  // ─── Web push (admin-side) ─────────────────────────────
  // Admins fetch the SAME public VAPID key as customers (the endpoint is
  // public), so no admin-specific vapidPublicKey() method — reuse the
  // customer one from notificationsService if you need it directly, or
  // just call the shared api helper.
  webSubscribe(payload: {
    endpoint: string;
    keys: { p256dh: string; auth: string };
    userAgent?: string;
  }): Promise<{ message: string }> {
    return api.post<{ message: string }>('/api/admin/notifications/web-subscribe', payload);
  },
  webUnsubscribe(endpoint: string): Promise<{ deleted: number }> {
    return api.post<{ deleted: number }>('/api/admin/notifications/web-unsubscribe', { endpoint });
  },
};
