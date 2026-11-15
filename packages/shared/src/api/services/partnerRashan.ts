import { api } from '../client';
import type {
  RashanPack, RashanPackItem, RashanFrequency, RashanSubStatus,
  SubDeliveryStatus, SubscriptionDelivery, AdminPaged, DeliveryRiderSummary,
} from './rashan';

/**
 * PARTNER RASHAN
 *
 * A partner's own pack templates, the subscriptions sold from them, and the
 * delivery schedule they fulfil. Separate file from `partner.ts` only because
 * that one is already ~650 lines; the auth model is identical (customer JWT +
 * an active PartnerStoreRole, store resolved server-side).
 *
 * Everything is implicitly scoped to the caller's store — no endpoint here
 * takes a store id, and sending one would be ignored.
 */

/** What the partner submits. `slug` is the BARE slug — the API prefixes it
 *  with the store slug so two stores can both have an "esencial". */
export interface PartnerPackPayload {
  slug: string;
  name_es: string;
  name_en: string;
  tagline_es?: string | null;
  tagline_en?: string | null;
  description_es?: string | null;
  description_en?: string | null;
  badge_es?: string | null;
  badge_en?: string | null;
  cover_url?: string | null;
  emoji?: string | null;
  gradient?: string | null;
  accent?: string | null;
  /** 0 means "work it out from the items". */
  base_price?: number;
  estimated_savings_pct?: number;
  household_default?: number;
  highlights_es?: string[];
  highlights_en?: string[];
  items: RashanPackItem[];
  sort_order?: number;
  is_active?: boolean;
}

export type PartnerPackRow = RashanPack & { _count: { subscriptions: number } };

export interface PartnerSubscriptionRow {
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
  user: { id: string; name: string; phone: string | null; email: string | null };
  pack: { id: string; slug: string; name_es: string; name_en: string; emoji: string | null } | null;
  address: { id: string; street_line_1: string; postcode: string; city: string };
  _count: { deliveries: number };
}

export interface PartnerDeliveryRow extends SubscriptionDelivery {
  subscription: {
    id: string;
    frequency: RashanFrequency;
    household: number;
    total_per_cycle: number;
    user: { id: string; name: string; phone: string | null; email: string | null };
    address: { id: string; street_line_1: string; postcode: string; city: string };
    pack: { id: string; slug: string; name_es: string; name_en: string } | null;
  };
  rider?: DeliveryRiderSummary | null;
}

// Type aliases, not interfaces: `api.get` takes a
// Record<string, string|number|boolean|null|undefined> query bag, and
// TypeScript only grants an implicit index signature to type aliases. An
// interface here fails to assign with a fairly opaque error.
export type PartnerSubscriptionsParams = {
  status?: RashanSubStatus;
  packId?: string;
  q?: string;
  page?: number;
  limit?: number;
};

export type PartnerDeliveriesParams = {
  status?: SubDeliveryStatus;
  from?: string;
  to?: string;
  q?: string;
  page?: number;
  limit?: number;
};

export const partnerRashan = {
  // ─── Packs ───
  listPacks() {
    return api.get<PartnerPackRow[]>('/api/partner/rashan/packs');
  },
  getPack(id: string) {
    return api.get<PartnerPackRow>(`/api/partner/rashan/packs/${id}`);
  },
  createPack(payload: PartnerPackPayload) {
    return api.post<PartnerPackRow>('/api/partner/rashan/packs', payload);
  },
  updatePack(id: string, payload: PartnerPackPayload) {
    return api.put<PartnerPackRow>(`/api/partner/rashan/packs/${id}`, payload);
  },
  deletePack(id: string) {
    return api.delete<{ message: string }>(`/api/partner/rashan/packs/${id}`);
  },

  // ─── Subscriptions (read-only — the customer owns pause/cancel) ───
  listSubscriptions(params: PartnerSubscriptionsParams = {}) {
    return api.get<AdminPaged<PartnerSubscriptionRow>>('/api/partner/rashan/subscriptions', params);
  },
  getSubscription(id: string) {
    return api.get<PartnerSubscriptionRow & { deliveries: SubscriptionDelivery[] }>(
      `/api/partner/rashan/subscriptions/${id}`,
    );
  },

  // ─── Deliveries ───
  listDeliveries(params: PartnerDeliveriesParams = {}) {
    return api.get<AdminPaged<PartnerDeliveryRow>>('/api/partner/rashan/deliveries', params);
  },
  setDeliveryStatus(id: string, status: SubDeliveryStatus, failureReason?: string) {
    return api.put<SubscriptionDelivery>(`/api/partner/rashan/deliveries/${id}/status`, {
      status,
      failure_reason: failureReason ?? null,
    });
  },
  assignDeliveryRider(id: string, riderId: string | null) {
    return api.put<SubscriptionDelivery>(`/api/partner/rashan/deliveries/${id}/rider`, { riderId });
  },
};
