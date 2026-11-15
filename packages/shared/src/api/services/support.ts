import { api } from '../client';

export type SupportTicketStatus = 'new' | 'in_progress' | 'resolved' | 'archived';

export interface SupportTicket {
  id: string;
  user_id: string | null;
  name: string;
  email: string;
  phone: string | null;
  subject: string;
  body: string;
  source: string;
  order_id: string | null;
  status: SupportTicketStatus;
  admin_notes: string | null;
  language: 'en' | 'es' | null;
  created_at: string;
  updated_at: string;
}

export interface SubmitTicketPayload {
  name: string;
  email: string;
  phone?: string | null;
  subject: string;
  body: string;
  /** Where the form lives — defaults to "contact_form" server-side. */
  source?: string;
  order_id?: string | null;
  language?: 'en' | 'es' | null;
}

export interface ListTicketsParams {
  status?: SupportTicketStatus;
  q?: string;
  page?: number;
  limit?: number;
}

export interface ListTicketsResponse {
  items: SupportTicket[];
  total: number;
  page: number;
  limit: number;
  /** Optional — see note in ListLeadsResponse. Client falls back to Math.ceil(total/limit). */
  totalPages?: number;
  /** Per-status counts across the whole table (not filtered). */
  counts: Partial<Record<SupportTicketStatus, number>>;
}

export interface PatchTicketPayload {
  status?: SupportTicketStatus;
  admin_notes?: string | null;
}

/** Public — submits a support ticket from /contact or Help Center CTAs. */
export const supportService = {
  submit(payload: SubmitTicketPayload): Promise<{ ok: true }> {
    return api.post<{ ok: true }>('/api/support', payload);
  },
};

/** Admin — JWT-guarded list / detail / patch. */
export const adminSupport = {
  list(params: ListTicketsParams = {}): Promise<ListTicketsResponse> {
    const qs = new URLSearchParams();
    if (params.status) qs.set('status', params.status);
    if (params.q)      qs.set('q', params.q);
    if (params.page)   qs.set('page', String(params.page));
    if (params.limit)  qs.set('limit', String(params.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return api.get<ListTicketsResponse>(`/api/admin/support${suffix}`);
  },
  get(id: string): Promise<SupportTicket> {
    return api.get<SupportTicket>(`/api/admin/support/${id}`);
  },
  update(id: string, payload: PatchTicketPayload): Promise<SupportTicket> {
    return api.patch<SupportTicket>(`/api/admin/support/${id}`, payload);
  },
};
