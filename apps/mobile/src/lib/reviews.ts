import { useMemo } from 'react';
import {
  useProductReviews,
  useReviewEligibility,
  useWriteReview,
  useDeleteMyReview,
  useReportReview,
  type ProductReview,
} from '@grocery-app/shared';
import { useAuthStore } from '../stores/authStore';

/**
 * Adapter between the reviews API and the shapes the review UI already
 * renders.
 *
 * This replaces src/stores/reviewStore.ts, which persisted reviews to
 * AsyncStorage and seeded five invented reviewers — Priya Malhotra, Ahmed
 * Khan, Laura Romero, Junaid Ahmed, Sara Iqbal — onto EVERY product. They were
 * never real, they were device-local, and shipping them to customers was the
 * single worst thing in the app.
 *
 * The row/stat shapes are kept so ReviewRow, the product page and the reviews
 * screen did not need rewriting. Two fields are gone for good: `email` and
 * `city` were free-typed by whoever left the review, and authorship now comes
 * from the session instead.
 */

export interface Review {
  id: string;
  productId: string;
  name: string;
  initials: string;
  rating: number;
  title?: string;
  body: string;
  createdAt: string;
  /** The signed-in user wrote this one, so they can edit or delete it. */
  owned: boolean;
}

export interface ReviewStats {
  rating: number;
  count: number;
  /** 1★ → 5★ counts, in that order. */
  dist: [number, number, number, number, number];
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function toReview(row: ProductReview, productId: string, currentUserId?: string): Review {
  return {
    id: row.id,
    productId,
    name: row.user?.name ?? 'Cesto',
    initials: initialsFromName(row.user?.name ?? 'Cesto'),
    rating: row.rating,
    title: row.title ?? undefined,
    body: row.body,
    createdAt: row.created_at,
    owned: !!currentUserId && row.user?.id === currentUserId,
  };
}

/**
 * Everything the review UI needs for one product in a single call.
 *
 * `limit` is generous because both screens sort client-side — the product page
 * shows the first few and the dedicated screen sorts the lot. Real pagination
 * only becomes worth it once a product carries hundreds of reviews.
 */
export function useReviewsFor(productId: string | undefined, limit = 50) {
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const { data, isLoading, isError } = useProductReviews(productId, { limit });
  const eligibility = useReviewEligibility(productId, isAuthenticated);

  const reviews = useMemo<Review[]>(() => {
    if (!data || !productId) return [];
    const rows = data.items.map((r) => toReview(r, productId, user?.id));
    // The caller's own review may sit outside the first page; surface it at
    // the top either way, and never twice.
    if (data.mine && !rows.some((r) => r.id === data.mine!.id)) {
      rows.unshift(toReview(data.mine, productId, user?.id));
    }
    return rows;
  }, [data, productId, user?.id]);

  const stats = useMemo<ReviewStats>(() => {
    const d = data?.summary.distribution;
    return {
      rating: data?.summary.average ?? 0,
      count: data?.summary.total ?? 0,
      dist: [
        d?.['1'] ?? 0, d?.['2'] ?? 0, d?.['3'] ?? 0, d?.['4'] ?? 0, d?.['5'] ?? 0,
      ],
    };
  }, [data]);

  const mine = useMemo<Review | null>(
    () => (data?.mine && productId ? toReview(data.mine, productId, user?.id) : null),
    [data, productId, user?.id],
  );

  return {
    reviews,
    stats,
    mine,
    isLoading,
    isError,
    /** Delivered order exists → the customer may write. Guests get false. */
    canReview: isAuthenticated && eligibility.data?.can_review === true,
    /** Their review was moderated; it still blocks a new one. */
    isHidden: eligibility.data?.is_hidden === true,
    isAuthenticated,
  };
}

export { useWriteReview, useDeleteMyReview, useReportReview };
export type { ReviewReportReason } from '@grocery-app/shared';
