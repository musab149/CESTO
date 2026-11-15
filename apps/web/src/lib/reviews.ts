import { useMemo } from 'react';
import {
  useProductReviews,
  useReviewEligibility,
  useWriteReview,
  useDeleteMyReview,
  useReportReview,
  type ProductReview,
} from '@grocery-app/shared';
import { useAuthStore } from '@/stores/authStore';

/**
 * Adapter between the reviews API and the shapes ProductDetailPage renders.
 *
 * Replaces src/stores/reviewStore.ts, which kept reviews in localStorage. That
 * store had no fabricated seeds (unlike mobile's, which shipped five invented
 * reviewers), but it was still device-local: a review written here never
 * reached the API, never appeared on mobile, and vanished when the browser was
 * cleared.
 *
 * `email` and `city` are gone. They were free-typed next to the reviewer's own
 * name; authorship now comes from the session.
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

export function useReviewsFor(productId: string | undefined, limit = 50) {
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const { data, isLoading } = useProductReviews(productId, { limit });
  const eligibility = useReviewEligibility(productId, isAuthenticated);

  const reviews = useMemo<Review[]>(() => {
    if (!data || !productId) return [];
    const rows = data.items.map((r) => toReview(r, productId, user?.id));
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
      dist: [d?.['1'] ?? 0, d?.['2'] ?? 0, d?.['3'] ?? 0, d?.['4'] ?? 0, d?.['5'] ?? 0],
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
    canReview: isAuthenticated && eligibility.data?.can_review === true,
    isAuthenticated,
  };
}

export { useWriteReview, useDeleteMyReview, useReportReview };
export type { ReviewReportReason } from '@grocery-app/shared';
