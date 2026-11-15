import { api } from '../client';
import type { RashanFrequency } from './rashan';

/**
 * RASHAN LEADS — Home Grocery requests from the form on /rashan.
 *
 * An admin approves one (the household becomes a Home Grocery subscriber) or
 * rejects it with a reason the household is told. Separate from B2bLead on
 * purpose: this is a household, not a business. Public submission (no
 * login) — see routes/rashanLeads.ts for why.
 */

/**
 * Cadence in plain weeks, as the form asks it. Deliberately wider than
 * `RashanFrequency` (the subscription enum) — `leadFrequencyToSubscription`
 * below narrows it when the lead is carried into the pack builder.
 */
export type RashanLeadFrequency = 'weekly' | 'biweekly' | 'every_3_weeks' | 'monthly';

export type RashanLeadStatus =
  | 'new' | 'contacted' | 'qualified' | 'converted' | 'closed' | 'archived';

export type RashanLeadContactPref = 'whatsapp' | 'call' | 'sms' | 'email';

/**
 * The decision, apart from `status` (the ops funnel) — the way B2bLead keeps
 * approval_status apart from its triage string. This is the one the
 * household is told about.
 */
export type RashanLeadApprovalStatus = 'pending_review' | 'approved' | 'rejected';

/**
 * The account a request maps to: the one signed in when it was sent, else
 * the one with its email. Null when there is none — approving then OPENS an
 * account; otherwise approving LINKS this one and leaves its password alone.
 */
export interface RashanLeadAccount {
  id: string;
  name: string;
  email: string | null;
  is_business: boolean;
  blocked: boolean;
  /** False means approval must collect an address, or no order can be built. */
  has_address: boolean;
}

/**
 * Narrow the lead cadence onto the subscription enum, which only knows
 * biweekly / monthly / every_6_weeks. `weekly` and `every_3_weeks` have no
 * exact home, so they round to the nearest cadence the subscription engine
 * can actually schedule. The lead keeps the household's real answer — ops
 * see "every week" in the admin queue and can arrange it manually.
 */
export function leadFrequencyToSubscription(f: RashanLeadFrequency): RashanFrequency {
  switch (f) {
    case 'weekly':
    case 'biweekly':
      return 'biweekly';
    case 'every_3_weeks':
    case 'monthly':
    default:
      return 'monthly';
  }
}

export interface RashanLead {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  language: 'en' | 'es' | null;

  household_size: number;
  adults: number | null;
  children: number | null;

  frequency: RashanLeadFrequency;
  preferred_start_date: string | null;
  interested_pack_slug: string | null;
  /** Serialised Prisma Decimal — a string over the wire. */
  budget_per_cycle: string | null;
  dietary_notes: string | null;

  address_line: string | null;
  city: string | null;
  postcode: string | null;
  preferred_slot: string | null;

  contact_pref: RashanLeadContactPref;
  source: string;
  status: RashanLeadStatus;
  notes: string | null;

  user_id: string | null;
  converted_subscription_id: string | null;
  converted_at: string | null;

  /** Optional: an API deployed before the Home Grocery revamp omits these. */
  approval_status?: RashanLeadApprovalStatus;
  approved_at?: string | null;
  approved_user_id?: string | null;
  rejected_at?: string | null;
  /** Shown to the household — written for them, not as an ops note. */
  rejection_reason?: string | null;
  /** Admin endpoints only. Undefined from an older API, null for no match. */
  account?: RashanLeadAccount | null;

  created_at: string;
  updated_at: string;
}

export interface SubmitRashanLeadPayload {
  name: string;
  phone: string;
  email?: string | null;

  household_size: number;
  adults?: number | null;
  children?: number | null;

  frequency: RashanLeadFrequency;
  /** ISO datetime string. */
  preferred_start_date?: string | null;
  interested_pack_slug?: string | null;
  budget_per_cycle?: number | null;
  dietary_notes?: string | null;

  address_line?: string | null;
  city?: string | null;
  postcode?: string | null;
  preferred_slot?: string | null;

  contact_pref?: RashanLeadContactPref;
  source?: string;
  language?: 'en' | 'es' | null;
}

export interface ListRashanLeadsParams {
  /** Only requests still waiting on a decision. */
  open?: boolean;
  approval?: RashanLeadApprovalStatus;
  status?: RashanLeadStatus;
  frequency?: RashanLeadFrequency;
  q?: string;
  page?: number;
  limit?: number;
}

export interface ListRashanLeadsResponse {
  items: RashanLead[];
  total: number;
  page: number;
  limit: number;
  totalPages?: number;
  /** Per-status counts across the whole table (not filtered). */
  counts: Partial<Record<RashanLeadStatus, number>>;
}

export interface PatchRashanLeadPayload {
  status?: RashanLeadStatus;
  notes?: string | null;
}

/** Same shape as the client form's address — see lib/createClient. */
export interface HomeGroceryAddressInput {
  label?: string;
  contact_name: string;
  contact_phone: string;
  street_line_1: string;
  street_line_2?: string;
  postcode: string;
  city: string;
  province: string;
  delivery_notes?: string;
}

export interface ApproveRashanLeadPayload {
  user: {
    name: string;
    email: string;
    phone?: string;
    preferred_language?: 'es' | 'en';
  };
  /** Required when no account exists yet, or the one that does has no address. */
  address?: HomeGroceryAddressInput;
  profile: {
    household_size: number;
    adults?: number | null;
    children?: number | null;
    frequency: RashanLeadFrequency;
    preferred_slot?: string | null;
    dietary_notes?: string | null;
    budget_per_cycle?: number | null;
    contact_phone?: string | null;
  };
}

export interface ApproveRashanLeadResult {
  user_id: string;
  /** `created`: account opened, login emailed. `linked`: their own account, untouched. */
  account: 'created' | 'linked';
  /** False when the mail did not reach a real provider. */
  email_sent: boolean;
}

export interface RejectRashanLeadResult {
  notified_in_app: boolean;
  email_sent: boolean;
}

/** A household's own view of one of its requests. */
export interface MyHomeGroceryRequest {
  id: string;
  approval_status: RashanLeadApprovalStatus;
  created_at: string;
  approved_at: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
}

/** Where the signed-in customer stands — drives /rashan. */
export interface MyHomeGrocery {
  /** Set once approved. */
  subscriber: {
    household_size: number;
    frequency: RashanLeadFrequency;
    approved_at: string;
  } | null;
  /** A request still waiting on a decision. */
  open_request: MyHomeGroceryRequest | null;
  /** The most recent approval or rejection — the reason lives here. */
  last_decision: MyHomeGroceryRequest | null;
}

/** Customer-facing. `submit` is public; `mine` needs a session. */
export const rashanLeadsService = {
  submit(payload: SubmitRashanLeadPayload): Promise<{ ok: true; id: string }> {
    return api.post<{ ok: true; id: string }>('/api/rashan-leads', payload);
  },
  mine(): Promise<MyHomeGrocery> {
    return api.get<MyHomeGrocery>('/api/rashan-leads/mine');
  },
};

/** Admin — JWT-guarded list / detail / triage patch. */
export const adminRashanLeads = {
  list(params: ListRashanLeadsParams = {}): Promise<ListRashanLeadsResponse> {
    const qs = new URLSearchParams();
    if (params.open)      qs.set('open', 'true');
    if (params.approval)  qs.set('approval', params.approval);
    if (params.status)    qs.set('status', params.status);
    if (params.frequency) qs.set('frequency', params.frequency);
    if (params.q)         qs.set('q', params.q);
    if (params.page)      qs.set('page', String(params.page));
    if (params.limit)     qs.set('limit', String(params.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return api.get<ListRashanLeadsResponse>(`/api/admin/rashan-leads${suffix}`);
  },
  get(id: string): Promise<RashanLead> {
    return api.get<RashanLead>(`/api/admin/rashan-leads/${id}`);
  },
  update(id: string, payload: PatchRashanLeadPayload): Promise<RashanLead> {
    return api.patch<RashanLead>(`/api/admin/rashan-leads/${id}`, payload);
  },
  approve(id: string, payload: ApproveRashanLeadPayload): Promise<ApproveRashanLeadResult> {
    return api.post<ApproveRashanLeadResult>(`/api/admin/rashan-leads/${id}/approve`, payload);
  },
  reject(id: string, reason: string): Promise<RejectRashanLeadResult> {
    return api.post<RejectRashanLeadResult>(`/api/admin/rashan-leads/${id}/reject`, { reason });
  },
};
