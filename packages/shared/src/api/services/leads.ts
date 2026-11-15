import { api } from '../client';

/**
 * What the applicant is:
 *   business      — wholesale BUYER (/b2b-deals). Approval creates a User +
 *                   BusinessProfile with b2b pricing. No store.
 *   partner_store — SELLER (/partner-deals). Approval creates a Store +
 *                   PartnerStoreRole.
 *   contact       — sales-modal enquiry, no approval path.
 *   quotation     — product quotation request from the product detail page.
 *                   No approval path, like 'contact'.
 *
 * Renamed 2026-07-27 from 'partner'/'supplier', which were inverted: the old
 * 'partner' value came from the BUYER form yet drove store creation.
 * Migration 20260727120000_b2b_business_accounts remapped stored rows, so no
 * legacy values survive and this union needs no back-compat members.
 */
export type B2bLeadType   = 'business' | 'partner_store' | 'contact' | 'quotation';
export type B2bLeadStatus = 'new' | 'contacted' | 'qualified' | 'closed' | 'archived';
export type B2bLeadIntent = 'supplier' | 'partner' | 'general';

/**
 * One shop location on a supplier/partner submission. Address is what the
 * user picked from Google Places; lat/lng lets admin drop a pin without
 * re-geocoding. place_id + the parsed components are stored best-effort.
 */
export interface B2bLeadShop {
  name: string;
  address: string;
  /** lat/lng come from Google Places when picked; null if the user typed the
   *  address manually because Places was unavailable at the time. */
  lat: number | null;
  lng: number | null;
  place_id?: string | null;
  city?: string | null;
  postcode?: string | null;
  country?: string | null;
}

/** MV Slice 1 — partner approval workflow state.
 *  Only meaningful when `type === 'partner'`; other lead types stay at
 *  `pending_review` forever and are ignored by the approval UI. */
export type B2bLeadApprovalStatus = 'pending_review' | 'approved' | 'needs_info' | 'rejected';

export interface B2bLead {
  id: string;
  type: B2bLeadType;
  source: string;
  name: string;
  company: string;
  email: string;
  phone: string;
  location: string | null;
  business_type: string | null;
  website: string | null;
  registration_no: string | null;
  shops: B2bLeadShop[] | null;
  message: string | null;
  intent: B2bLeadIntent | null;
  /** Quotation-request fields (type='quotation' only). */
  quote_product_id: string | null;
  quote_product_name: string | null;
  quote_quantity: number | null;
  status: B2bLeadStatus;
  notes: string | null;
  language: 'en' | 'es' | null;
  /** MV Slice 1 fields. Optional so older API responses (pre-migration
   *  20260716180000) don't force null-checks at every render site. */
  approval_status?: B2bLeadApprovalStatus;
  approved_at?: string | null;
  approved_store_id?: string | null;
  approved_partner_user_id?: string | null;
  /** User created (or linked) at approval — set by BOTH the business and
   *  partner_store paths. Supersedes approved_partner_user_id. Optional so
   *  a frontend deployed ahead of the API doesn't hard-fail. */
  approved_user_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface SubmitLeadPayload {
  type: B2bLeadType;
  source: string;
  name: string;
  company: string;
  email: string;
  phone: string;
  location?: string | null;
  business_type?: string | null;
  website?: string | null;
  registration_no?: string | null;
  shops?: B2bLeadShop[] | null;
  message?: string | null;
  intent?: B2bLeadIntent | null;
  /** Quotation-request fields (required when type='quotation'). */
  quote_product_id?: string | null;
  quote_product_name?: string | null;
  quote_quantity?: number | null;
  language?: 'en' | 'es' | null;
}

export interface ListLeadsParams {
  status?: B2bLeadStatus;
  type?: B2bLeadType;
  /** Only leads nobody has approved or rejected yet. Filtered server-side. */
  open?: boolean;
  q?: string;
  page?: number;
  limit?: number;
}

export interface ListLeadsResponse {
  items: B2bLead[];
  total: number;
  page: number;
  limit: number;
  /**
   * Server-computed total pages. Optional because a couple of older
   * envelopes we consume didn't emit it; the client can fall back to
   * Math.ceil(total / limit).
   */
  totalPages?: number;
  /** Per-status counts across the whole table (not filtered). */
  counts: Partial<Record<B2bLeadStatus, number>>;
}

export interface PatchLeadPayload {
  status?: B2bLeadStatus;
  notes?: string | null;
}

// ─── MV Slice 1 · partner approval payloads ──────────────

export interface ApprovePartnerPayload {
  partner_user: {
    name: string;
    email: string;
  };
  /** Choose ONE: link to an existing store, or create a new one inline. */
  store_id?: string;
  store?: {
    name: string;
    tagline_es?: string;
    tagline_en?: string;
    description_es?: string;
    description_en?: string;
    contact_email?: string;
    contact_phone?: string;
    origin?: string;
  };
}

/**
 * B2B business (wholesale buyer) approval. No store — that's the difference
 * from ApprovePartnerPayload. Trading details are prefilled from the lead by
 * the admin UI but editable before submitting.
 */
export interface ApproveBusinessPayload {
  user: {
    name: string;
    email: string;
  };
  business: {
    company: string;
    business_type?: string | null;
    location?: string | null;
    website?: string | null;
    registration_no?: string | null;
    contact_phone?: string | null;
  };
}

export interface ApproveBusinessResult {
  approved_user_id: string;
  user_was_created: boolean;
  message: string;
}

export interface RequestPartnerInfoPayload {
  message: string;
}

export interface RejectPartnerPayload {
  reason: string;
}

/** Applicant-facing view of a lead — no admin-only fields (notes etc). */
export interface LeadStatusView {
  id: string;
  company: string;
  name: string;
  email: string;
  approval_status: B2bLeadApprovalStatus;
  expires_at: string | null;
  location: string | null;
  business_type: string | null;
  website: string | null;
  registration_no: string | null;
  shops: B2bLeadShop[] | null;
}

export interface ResubmitLeadPayload {
  location?: string;
  business_type?: string;
  website?: string;
  registration_no?: string;
  shops?: B2bLeadShop[];
  /** Optional note back to the admin explaining what was updated. */
  note?: string;
}

/** Public customer-facing — submits a B2B application or contact-sales lead. */
export const leadsService = {
  submit(payload: SubmitLeadPayload): Promise<{ ok: true }> {
    return api.post<{ ok: true }>('/api/leads', payload);
  },
  /** MV Slice 1 — fetch applicant view via magic-link token. */
  getStatusByToken(token: string): Promise<LeadStatusView> {
    return api.get<LeadStatusView>(`/api/leads/status/${encodeURIComponent(token)}`);
  },
  /** MV Slice 1 — applicant resubmits updated info via magic-link token. */
  resubmit(token: string, payload: ResubmitLeadPayload): Promise<{ ok: true; message: string }> {
    return api.post<{ ok: true; message: string }>(
      `/api/leads/status/${encodeURIComponent(token)}/resubmit`,
      payload,
    );
  },
};

/** Admin — JWT-guarded list / detail / patch + Slice 1 approval actions. */
export const adminLeads = {
  list(params: ListLeadsParams = {}): Promise<ListLeadsResponse> {
    const qs = new URLSearchParams();
    if (params.status) qs.set('status', params.status);
    if (params.type)   qs.set('type', params.type);
    if (params.open)   qs.set('open', 'true');
    if (params.q)      qs.set('q', params.q);
    if (params.page)   qs.set('page', String(params.page));
    if (params.limit)  qs.set('limit', String(params.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return api.get<ListLeadsResponse>(`/api/admin/leads${suffix}`);
  },
  get(id: string): Promise<B2bLead> {
    return api.get<B2bLead>(`/api/admin/leads/${id}`);
  },
  update(id: string, payload: PatchLeadPayload): Promise<B2bLead> {
    return api.patch<B2bLead>(`/api/admin/leads/${id}`, payload);
  },
  /** B2B business (wholesale buyer) approval — creates a User +
   *  BusinessProfile with b2b pricing. 422s if the lead is a partner_store. */
  approveBusiness(id: string, payload: ApproveBusinessPayload): Promise<ApproveBusinessResult> {
    return api.post<ApproveBusinessResult>(`/api/admin/leads/${id}/approve-business`, payload);
  },
  // MV Slice 1 · approval actions (gated on MV_PARTNER_APPROVAL server-side).
  approve(id: string, payload: ApprovePartnerPayload): Promise<{
    approved_store_id: string;
    approved_partner_user_id: string;
    message: string;
  }> {
    return api.post(`/api/admin/leads/${id}/approve`, payload);
  },
  requestInfo(id: string, payload: RequestPartnerInfoPayload): Promise<{ message: string }> {
    return api.post(`/api/admin/leads/${id}/request-info`, payload);
  },
  reject(id: string, payload: RejectPartnerPayload): Promise<{ message: string }> {
    return api.post(`/api/admin/leads/${id}/reject`, payload);
  },
};
