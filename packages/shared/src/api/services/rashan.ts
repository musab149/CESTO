import { api } from '../client';
import type { Address, PaymentMethod, VehicleType } from '../../types';

export interface DeliveryRiderSummary {
  id: string;
  name: string;
  phone: string;
  vehicle_type: VehicleType;
}

export interface SubscriptionDeliveryOrderSummary {
  id: string;
  order_number: string;
  status: string;
}

/* ─── Shared types ─────────────────────────────────── */

export type RashanFrequency = 'biweekly' | 'monthly' | 'every_6_weeks';
export type RashanSubStatus = 'active' | 'paused' | 'cancelled';
export type SubDeliveryStatus =
  | 'scheduled'
  | 'awaiting_confirmation'
  | 'confirmed'
  | 'preparing'
  | 'on_the_way'
  | 'delivered'
  | 'skipped'
  | 'failed';

export interface RashanPackItem {
  product_id: string;
  variant_id: string;
  quantity: number;
}

/**
 * Store attached to a pack or subscription. NULL/absent means Cesto — the
 * house shop, which has no Store row. Render sites treat "no store" as the
 * platform brand rather than as missing data.
 */
export interface RashanPackStore {
  id: string;
  slug: string;
  name: string;
  logo_url: string | null;
  /**
   * Everything below is optional because the customer and admin endpoints
   * select different columns: the customer rail needs the branding
   * (logo_bg / is_verified / rating) to attribute a card, while admin needs
   * lifecycle `status` to explain why a live pack isn't showing. Neither
   * sends the other's fields.
   */
  logo_bg?: string | null;
  is_verified?: boolean;
  rating?: number | null;
  status?: 'draft' | 'live' | 'paused' | 'suspended';
}

export interface RashanPack {
  id: string;
  /** NULL = a Cesto pack. Set = built by that partner store. */
  store_id: string | null;
  /** Eager-loaded by the customer + admin read endpoints. */
  store?: RashanPackStore | null;
  /**
   * Cesto takedown. When set the pack is hidden from customers regardless of
   * `is_active`, and the owning partner cannot edit it. Optional so a frontend
   * deployed ahead of the API doesn't hard-fail on the missing field.
   */
  admin_blocked_at?: string | null;
  admin_block_reason?: string | null;
  slug: string;
  name_es: string;
  name_en: string;
  tagline_es: string | null;
  tagline_en: string | null;
  description_es: string | null;
  description_en: string | null;
  badge_es: string | null;
  badge_en: string | null;
  /**
   * Cover photo for the pack card. Preferred over `emoji` at every render
   * site; `emoji` remains the fallback for packs that predate covers and for
   * an image that fails to load. Pass through `resolveImageUrl()` first.
   * Optional so a frontend deployed ahead of the API doesn't hard-fail.
   */
  cover_url?: string | null;
  emoji: string | null;
  gradient: string | null;
  accent: string | null;
  base_price: number;
  estimated_savings_pct: number;
  household_default: number;
  highlights_es: string[];
  highlights_en: string[];
  items: RashanPackItem[];
  is_custom: boolean;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SubscriptionDelivery {
  id: string;
  subscription_id: string;
  scheduled_date: string;
  status: SubDeliveryStatus;
  item_count: number;
  total: number;
  order_id: string | null;
  rider_id: string | null;
  failure_reason: string | null;
  delivered_at: string | null;
  created_at: string;
  updated_at: string;
  rider?: DeliveryRiderSummary | null;
  order?: SubscriptionDeliveryOrderSummary | null;
}

export interface RashanSubscription {
  id: string;
  user_id: string;
  pack_id: string | null;
  /** Who fulfils it. NULL = Cesto. Denormalised from the pack at creation. */
  store_id?: string | null;
  store?: RashanPackStore | null;
  pack_slug: string | null;
  items: RashanPackItem[];
  household: number;
  frequency: RashanFrequency;
  status: RashanSubStatus;
  address_id: string;
  slot_preference: string | null;
  payment_method: PaymentMethod;
  next_delivery_date: string | null;
  needs_confirmation: boolean;
  total_per_cycle: number;
  cycles_completed: number;
  paused_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  admin_notes: string | null;
  created_at: string;
  updated_at: string;
  /** Eager-loaded by all read endpoints. */
  pack?: RashanPack | null;
  address?: Address;
  deliveries?: SubscriptionDelivery[];
}

/* ─── Customer service ─────────────────────────────── */

export interface CreateSubscriptionPayload {
  packSlug?: string;
  items: RashanPackItem[];
  household?: number;
  frequency?: RashanFrequency;
  addressId: string;
  slotPreference?: string | null;
  paymentMethod?: PaymentMethod;
  firstDeliveryDate?: string;
}

export interface UpdateSubscriptionPayload {
  items?: RashanPackItem[];
  household?: number;
  frequency?: RashanFrequency;
  addressId?: string;
  slotPreference?: string | null;
  paymentMethod?: PaymentMethod;
}

export const rashanService = {
  // Public packs
  listPacks() {
    return api.get<RashanPack[]>('/api/rashan/packs');
  },
  getPack(slug: string) {
    return api.get<RashanPack>(`/api/rashan/packs/${slug}`);
  },

  // Customer subscriptions
  listSubscriptions() {
    return api.get<RashanSubscription[]>('/api/rashan/subscriptions');
  },
  getSubscription(id: string) {
    return api.get<RashanSubscription>(`/api/rashan/subscriptions/${id}`);
  },
  createSubscription(payload: CreateSubscriptionPayload) {
    return api.post<RashanSubscription>('/api/rashan/subscriptions', payload);
  },
  updateSubscription(id: string, payload: UpdateSubscriptionPayload) {
    return api.put<RashanSubscription>(`/api/rashan/subscriptions/${id}`, payload);
  },
  pauseSubscription(id: string) {
    return api.post<RashanSubscription>(`/api/rashan/subscriptions/${id}/pause`);
  },
  resumeSubscription(id: string) {
    return api.post<RashanSubscription>(`/api/rashan/subscriptions/${id}/resume`);
  },
  cancelSubscription(id: string, reason?: string) {
    return api.post<RashanSubscription>(`/api/rashan/subscriptions/${id}/cancel`, { reason });
  },
  skipNext(id: string) {
    return api.post<RashanSubscription>(`/api/rashan/subscriptions/${id}/skip-next`);
  },
  confirmNext(id: string) {
    return api.post<RashanSubscription>(`/api/rashan/subscriptions/${id}/confirm-next`);
  },
};

/* ─── Admin service ────────────────────────────────── */

export interface AdminPackPayload extends Omit<RashanPack, 'id' | 'created_at' | 'updated_at'> {}

export interface AdminSubSummary {
  total: number;
  active: number;
  paused: number;
  cancelled: number;
  awaiting_confirmation: number;
  mrr_eur: number;
}

export interface AdminPaged<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface AdminSubscriptionRow {
  id: string;
  status: RashanSubStatus;
  frequency: RashanFrequency;
  household: number;
  next_delivery_date: string | null;
  needs_confirmation: boolean;
  total_per_cycle: number;
  cycles_completed: number;
  pack_slug: string | null;
  created_at: string;
  updated_at: string;
  user: { id: string; name: string; email: string | null; phone: string | null };
  pack: { id: string; slug: string; name_es: string; name_en: string } | null;
  _count: { deliveries: number };
}

export interface AdminSubscriptionDetailItem {
  product_id: string;
  variant_id: string;
  quantity: number;
  product: { id: string; name_es: string; name_en: string; image_url: string | null } | null;
  variant: { id: string; name_es: string; name_en: string; price: number } | null;
}

export interface AdminSubscriptionDetail extends RashanSubscription {
  user: { id: string; name: string; email: string | null; phone: string | null };
  address: Address;
  pack: RashanPack | null;
  deliveries: SubscriptionDelivery[];
  /** Resolved product/variant/image data for each item so the admin UI never has to do a paginated client-side join. */
  items_resolved?: AdminSubscriptionDetailItem[];
}

export interface AdminUpdateSubPayload {
  items?: RashanPackItem[];
  household?: number;
  frequency?: RashanFrequency;
  status?: RashanSubStatus;
  next_delivery_date?: string | null;
  slot_preference?: string | null;
  payment_method?: PaymentMethod;
  needs_confirmation?: boolean;
  admin_notes?: string | null;
}

export interface AdminDeliveryRow extends SubscriptionDelivery {
  subscription: {
    id: string;
    frequency: RashanFrequency;
    household: number;
    total_per_cycle: number;
    user: { id: string; name: string; phone: string | null; email: string | null };
    address: { id: string; street_line_1: string; postcode: string; city: string };
    pack: { id: string; slug: string; name_es: string; name_en: string } | null;
  };
  order: { id: string; order_number: string; status: string } | null;
}

/** Which half of the pack catalogue an admin is looking at. */
export type AdminPackOwner = 'cesto' | 'partner';

export type AdminPackRow = RashanPack & { _count: { subscriptions: number } };

export const adminRashan = {
  // Packs
  listPacks(params: { owner?: AdminPackOwner } = {}) {
    return api.get<AdminPackRow[]>('/api/admin/rashan/packs', params);
  },
  getPack(id: string) {
    return api.get<RashanPack & { _count: { subscriptions: number } }>(`/api/admin/rashan/packs/${id}`);
  },
  createPack(payload: Partial<AdminPackPayload>) {
    return api.post<RashanPack>('/api/admin/rashan/packs', payload);
  },
  updatePack(id: string, payload: Partial<AdminPackPayload>) {
    return api.put<RashanPack>(`/api/admin/rashan/packs/${id}`, payload);
  },
  deletePack(id: string) {
    return api.delete<{ message: string }>(`/api/admin/rashan/packs/${id}`);
  },
  /** Take a partner pack down. Hides it everywhere and freezes partner edits. */
  blockPack(id: string, reason: string) {
    return api.post<AdminPackRow>(`/api/admin/rashan/packs/${id}/block`, { reason });
  },
  unblockPack(id: string) {
    return api.post<AdminPackRow>(`/api/admin/rashan/packs/${id}/unblock`);
  },

  // Subscriptions
  listSubscriptions(params: { status?: RashanSubStatus; q?: string; page?: number; limit?: number } = {}) {
    return api.get<AdminPaged<AdminSubscriptionRow>>('/api/admin/rashan/subscriptions', params);
  },
  getSubscription(id: string) {
    return api.get<AdminSubscriptionDetail>(`/api/admin/rashan/subscriptions/${id}`);
  },
  updateSubscription(id: string, payload: AdminUpdateSubPayload) {
    return api.put<AdminSubscriptionDetail>(`/api/admin/rashan/subscriptions/${id}`, payload);
  },
  summary() {
    return api.get<AdminSubSummary>('/api/admin/rashan/subscriptions/summary');
  },

  // Deliveries dashboard
  listDeliveries(params: { status?: SubDeliveryStatus; from?: string; to?: string; q?: string; page?: number; limit?: number } = {}) {
    return api.get<AdminPaged<AdminDeliveryRow>>('/api/admin/rashan/deliveries', params);
  },
  setDeliveryStatus(id: string, status: SubDeliveryStatus, failureReason?: string) {
    return api.put<SubscriptionDelivery>(`/api/admin/rashan/deliveries/${id}/status`, {
      status,
      failure_reason: failureReason ?? null,
    });
  },
  assignDeliveryRider(id: string, riderId: string | null) {
    return api.put<SubscriptionDelivery>(`/api/admin/rashan/deliveries/${id}/rider`, { riderId });
  },
};
