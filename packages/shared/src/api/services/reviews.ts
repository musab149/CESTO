import { api } from '../client';

// ─── Types ──────────────────────────────────────────────

export interface ProductReview {
  id: string;
  rating: number;
  title: string | null;
  body: string;
  created_at: string;
  updated_at: string;
  user: { id: string; name: string };
  /** Only present on the caller's own review (`mine`). */
  is_hidden?: boolean;
}

export interface ReviewSummary {
  /** Null when there are no visible reviews — render "no reviews yet". */
  average: number | null;
  total: number;
  distribution: Record<'1' | '2' | '3' | '4' | '5', number>;
}

export interface ProductReviewsResponse {
  items: ProductReview[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  summary: ReviewSummary;
  /** The signed-in caller's own review, if any. Null for guests. */
  mine: ProductReview | null;
}

export interface ReviewEligibility {
  /** True once a delivered order containing the product exists. */
  can_review: boolean;
  has_reviewed: boolean;
  /** Their existing review was moderated. It still blocks a new one. */
  is_hidden: boolean;
}

export interface WriteReviewPayload {
  rating: number;
  title?: string | null;
  body: string;
}

/** Why a customer flagged a review. Mirrors the API's ReviewReportReason. */
export type ReviewReportReason =
  | 'spam'
  | 'offensive'
  | 'off_topic'
  | 'personal_info'
  | 'not_a_real_purchase';

export interface ReportReviewPayload {
  reason: ReviewReportReason;
  note?: string | null;
}

// ─── Public ─────────────────────────────────────────────

export const reviewsService = {
  list(productId: string, params: { page?: number; limit?: number } = {}) {
    return api.get<ProductReviewsResponse>(`/api/products/${productId}/reviews`, params);
  },
  eligibility(productId: string) {
    return api.get<ReviewEligibility>(`/api/products/${productId}/reviews/eligibility`);
  },
  /** Create or replace the caller's review — the server upserts. */
  write(productId: string, payload: WriteReviewPayload) {
    return api.post<ProductReview>(`/api/products/${productId}/reviews`, payload);
  },
  removeMine(productId: string) {
    return api.delete<{ message: string }>(`/api/products/${productId}/reviews/mine`);
  },
  /** Flag someone else's review for moderation. Required by Google Play's UGC
   *  policy for publicly visible user content. Idempotent server-side, so a
   *  repeated tap re-states the report rather than erroring. */
  report(productId: string, reviewId: string, payload: ReportReviewPayload) {
    return api.post<{ message: string }>(
      `/api/products/${productId}/reviews/${reviewId}/report`,
      payload,
    );
  },
};

// ─── Admin ──────────────────────────────────────────────

/** One customer's report, as the moderation screen sees it. */
export interface AdminReviewReport {
  id: string;
  reason: ReviewReportReason;
  note: string | null;
  created_at: string;
  reporter: { id: string; name: string };
}

export interface AdminProductReview extends Omit<ProductReview, 'user'> {
  is_hidden: boolean;
  hidden_reason: string | null;
  hidden_at: string | null;
  order_id: string | null;
  user: { id: string; name: string; email: string };
  product: { id: string; name_es: string; name_en: string };
  /** OPEN reports only — dismissed ones are excluded server-side, so this
   *  count is "what is still outstanding", not "what was ever reported". */
  reports: AdminReviewReport[];
  report_count: number;
  last_reported_at: string | null;
}

export interface AdminReviewsParams {
  [key: string]: string | number | boolean | null | undefined;
  /** 'reported' = has at least one report nobody has dismissed. */
  visibility?: 'all' | 'visible' | 'hidden' | 'reported';
  maxRating?: number;
  q?: string;
  page?: number;
  limit?: number;
}

export const adminReviews = {
  list(params: AdminReviewsParams = {}) {
    return api.get<{
      items: AdminProductReview[];
      total: number; page: number; limit: number; totalPages: number;
    }>('/api/admin/reviews', params);
  },
  hide(id: string, reason?: string | null) {
    return api.post<{ id: string; is_hidden: boolean }>(`/api/admin/reviews/${id}/hide`, { reason: reason ?? null });
  },
  unhide(id: string) {
    return api.post<{ id: string; is_hidden: boolean }>(`/api/admin/reviews/${id}/unhide`, {});
  },
  remove(id: string) {
    return api.delete<{ message: string }>(`/api/admin/reviews/${id}`);
  },
  /** "I looked, the review stays." Clears the open reports without touching
   *  the review itself. */
  dismissReports(id: string) {
    return api.post<{ id: string; dismissed: number }>(
      `/api/admin/reviews/${id}/dismiss-reports`, {},
    );
  },
};
