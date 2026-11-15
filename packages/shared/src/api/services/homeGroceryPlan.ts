import { api } from '../client';
import type { RashanLeadFrequency } from './rashanLeads';

/**
 * Home Grocery plans — the API is packages/api/src/lib/homeGroceryPlan.ts.
 * Since 2026-10-22 a plan is an approved household's delivery settings, made
 * from its request; every Home Grocery order is placed by the household, staff
 * or a rep, with its own slot (a day and a part of the day). The list and
 * skip calls are the model before that, kept for screens not yet moved.
 */

/** The four a plan offers — the request form's. Counted in weeks: monthly = 4. */
export type PlanFrequency = RashanLeadFrequency;
export const PLAN_FREQUENCIES: PlanFrequency[] = ['weekly', 'biweekly', 'every_3_weeks', 'monthly'];

/** Part of the day — a preference, never a promise. */
export type DeliveryWindow = 'morning' | 'afternoon' | 'evening';
export const DELIVERY_WINDOWS: DeliveryWindow[] = ['morning', 'afternoon', 'evening'];

export type PlanStatus = 'active' | 'paused' | 'cancelled';

export interface PlanItem {
  product_id: string;
  variant_id: string;
  quantity: number;
}

export interface PlanAddress {
  id: string;
  contact_name: string;
  contact_phone: string;
  street_line_1: string;
  street_line_2: string | null;
  postcode: string;
  city: string;
  province: string;
  is_default: boolean;
}

export interface PlanRider {
  name: string;
  phone: string;
  vehicle_type: string;
}

/** A Home Grocery order under way. */
export interface PlanUpcoming {
  id: string;
  order_number: string;
  status: 'draft' | 'pending' | 'confirmed' | 'preparing' | 'on_the_way';
  /** Its slot: the day… */
  scheduled_for: string | null;
  /** …and the part of the day (null = any time). Optional: an older API omits it. */
  delivery_window?: DeliveryWindow | null;
  subtotal: string;
  delivery_fee: string;
  total: string;
  item_count: number;
  rider: PlanRider | null;
  /** The household can still change it — products and slot. */
  editable: boolean;
}

export interface PlanDeliveryRow {
  id: string;
  order_number: string;
  status: 'draft' | 'pending' | 'confirmed' | 'preparing' | 'on_the_way' | 'delivered' | 'cancelled';
  scheduled_for: string | null;
  delivery_window?: DeliveryWindow | null;
  total: string;
  cancelled_reason: string | null;
  item_count: number;
  rider?: PlanRider | null;
}

export interface HomeGroceryPlan {
  id: string;
  status: PlanStatus;
  /** `every_6_weeks` only on a legacy plan; never offered. */
  frequency: PlanFrequency | 'every_6_weeks';
  /** ISO weekday, 1 = Monday … 7 = Sunday. */
  preferred_weekday: number | null;
  preferred_window: DeliveryWindow | null;
  notify_before: boolean;
  items: PlanItem[];
  household: number;
  cycles_completed: number;
  next_delivery_date: string | null;
  paused_at: string | null;
  created_at: string;
  address: PlanAddress | null;
}

export interface HomeGroceryPlanView {
  /** An approved Home Grocery household — only they may have a plan. */
  subscriber: boolean;
  plan: HomeGroceryPlan | null;
  /** The earliest order under way. */
  upcoming: PlanUpcoming | null;
  /** Every order under way, earliest first. Optional: an older API omits it. */
  open?: PlanUpcoming[];
  /** The last few orders that settled (delivered or cancelled). */
  recent: PlanDeliveryRow[];
  /** The day the next order is due by the plan's frequency (YYYY-MM-DD). */
  next_due?: string | null;
  /** It is time to order: the due day is near and nothing is under way. */
  due?: boolean;
  /** Why no delivery could be planned, in words the household can act on. */
  problem: string | null;
  /** Products on the list that are off sale, and so left out of every delivery until they are back. */
  dropped: string[];
  /** After an edit: did it reach the delivery being planned, or only the next one? */
  applies_to?: 'upcoming' | 'next' | 'none';
  left_out?: string[];
  /** After a pause: a delivery staff already confirmed, which still goes ahead. */
  going_ahead?: string | null;
}

export interface PlanSettingsPayload {
  frequency?: PlanFrequency;
  preferred_weekday?: number | null;
  preferred_window?: DeliveryWindow | null;
  address_id?: string;
  notify_before?: boolean;
}

export interface CreatePlanPayload extends PlanSettingsPayload {
  address_id: string;
  /** The list before 2026-10-22 — sent by older screens, ignored by the API now. */
  items?: PlanItem[];
}

/** A Home Grocery order's slot: the day (YYYY-MM-DD) and the part of the day. */
export interface PlanSlot {
  scheduled_for: string;
  delivery_window?: DeliveryWindow | null;
}

export interface PlaceHomeGroceryOrderPayload extends PlanSlot {
  items: Array<{ variant_id: string; quantity: number }>;
  /** Another of their saved addresses, for this order only. */
  address_id?: string;
  customer_notes?: string;
}

export interface PlacedHomeGroceryOrder {
  order: {
    id: string;
    order_number: string;
    status: string;
    total: string;
    scheduled_for: string | null;
    delivery_window: DeliveryWindow | null;
  };
}

export type PlanHistoryFilter = 'all' | 'upcoming' | 'delivered' | 'cancelled';

export interface PlanDeliveriesPage {
  items: PlanDeliveryRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export const homeGroceryPlanService = {
  get: () => api.get<HomeGroceryPlanView>('/api/home-grocery/plan'),
  create: (payload: CreatePlanPayload) => api.post<HomeGroceryPlanView>('/api/home-grocery/plan', payload),
  updateItems: (items: PlanItem[]) => api.put<HomeGroceryPlanView>('/api/home-grocery/plan/items', { items }),
  updateSettings: (payload: PlanSettingsPayload) =>
    api.put<HomeGroceryPlanView>('/api/home-grocery/plan/settings', payload),
  pause: () => api.post<HomeGroceryPlanView>('/api/home-grocery/plan/pause', {}),
  resume: () => api.post<HomeGroceryPlanView>('/api/home-grocery/plan/resume', {}),
  skip: () => api.post<HomeGroceryPlanView>('/api/home-grocery/plan/skip', {}),
  deliveries: (params: { status?: PlanHistoryFilter; page?: number; limit?: number }) =>
    api.get<PlanDeliveriesPage>('/api/home-grocery/plan/deliveries', params),
  /** Place a Home Grocery order. The key makes a retry return the same order. */
  placeOrder: (payload: PlaceHomeGroceryOrderPayload, idempotencyKey: string) =>
    api.post<PlacedHomeGroceryOrder>('/api/home-grocery/plan/orders', payload, {
      headers: { 'Idempotency-Key': idempotencyKey },
      timeoutMs: 30_000,
    }),
  changeSlot: (orderId: string, slot: PlanSlot) =>
    api.put<{ id: string; scheduled_for: string; delivery_window: DeliveryWindow | null }>(
      `/api/home-grocery/plan/orders/${orderId}/slot`, slot,
    ),
};

// ─── Staff ───────────────────────────────────────────────────────────────────

export interface StaffPlanView extends HomeGroceryPlanView {
  profile: {
    household_size: number;
    adults: number | null;
    children: number | null;
    frequency: PlanFrequency;
    preferred_slot: string | null;
    dietary_notes: string | null;
    contact_phone: string | null;
    approved_at: string;
  } | null;
  addresses: PlanAddress[];
  user: { id: string; name: string; email: string | null; phone: string | null; is_business: boolean };
  /** One per line of the list, off the catalogue — off-sale lines included. Optional: an older API omits it. */
  catalogue?: StaffPlanLine[];
}

/** A line of the list as staff see it: what it is, today's price for this household, stock. */
export interface StaffPlanLine {
  variant_id: string;
  product_id: string;
  name_es: string;
  name_en: string;
  variant_es: string;
  variant_en: string;
  brand: string | null;
  sku: string | null;
  category_es: string | null;
  category_en: string | null;
  image_url: string | null;
  /** What this household pays per unit today — wholesale for a business account. */
  unit_price: string;
  stock: number;
  on_sale: boolean;
}

/** A subscriber row's plan on the Home Grocery tab. */
export interface PlanSummary {
  id: string;
  status: PlanStatus;
  frequency: HomeGroceryPlan['frequency'];
  next: {
    id: string; order_number: string; status: PlanUpcoming['status']; scheduled_for: string | null;
    delivery_window?: DeliveryWindow | null;
  } | null;
  /** When the next order is due, and whether that is now. Optional: an older API omits them. */
  next_due?: string | null;
  due?: boolean;
}

export interface UpcomingPlanDelivery {
  id: string;
  order_number: string;
  status: PlanUpcoming['status'];
  scheduled_for: string | null;
  delivery_window?: DeliveryWindow | null;
  total: string;
  item_count: number;
  rider: { id: string; name: string } | null;
  user: { id: string; name: string; phone: string | null };
  rashan_subscription: {
    preferred_window: DeliveryWindow | null;
    preferred_weekday: number | null;
    frequency: HomeGroceryPlan['frequency'];
  } | null;
  address_snapshot: { street_line_1?: string; postcode?: string; city?: string } | null;
}

const staffBase = (userId: string) => `/api/admin/home-grocery/plans/user/${userId}`;

export const adminHomeGroceryPlans = {
  get: (userId: string) => api.get<StaffPlanView>(staffBase(userId)),
  create: (userId: string, payload: CreatePlanPayload) => api.post<StaffPlanView>(staffBase(userId), payload),
  updateItems: (userId: string, items: PlanItem[]) => api.put<StaffPlanView>(`${staffBase(userId)}/items`, { items }),
  updateSettings: (userId: string, payload: PlanSettingsPayload) =>
    api.put<StaffPlanView>(`${staffBase(userId)}/settings`, payload),
  pause: (userId: string) => api.post<StaffPlanView>(`${staffBase(userId)}/pause`, {}),
  resume: (userId: string) => api.post<StaffPlanView>(`${staffBase(userId)}/resume`, {}),
  skip: (userId: string) => api.post<StaffPlanView>(`${staffBase(userId)}/skip`, {}),
  end: (userId: string, reason?: string) => api.post<StaffPlanView>(`${staffBase(userId)}/end`, { reason }),
  deliveries: (userId: string, params: { status?: PlanHistoryFilter; page?: number; limit?: number }) =>
    api.get<PlanDeliveriesPage>(`${staffBase(userId)}/deliveries`, params),
  upcoming: (days = 14) =>
    api.get<{ today: string; items: UpcomingPlanDelivery[] }>('/api/admin/home-grocery/upcoming', { days }),
  /** Move a Home Grocery order's slot — today included, for staff. */
  changeSlot: (orderId: string, slot: PlanSlot) =>
    api.put<{ id: string; scheduled_for: string; delivery_window: DeliveryWindow | null }>(
      `/api/admin/home-grocery/orders/${orderId}/slot`, slot,
    ),
};
