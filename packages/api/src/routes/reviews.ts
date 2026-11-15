import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { success, error } from '../lib/response';
import { asyncHandler } from '../lib/async';
import { requireAuth, optionalAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { parsePage, paged } from '../lib/pagination';

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const router = Router({ mergeParams: true });

/**
 * Customer product reviews.
 *
 * Mounted under /api/products/:productId/reviews. Reading is public; writing
 * requires both a session and a delivered order containing the product.
 *
 * `products.rating` / `rating_count` are the denormalised aggregate over the
 * visible rows and are recomputed inside the same transaction as every write —
 * see recomputeProductRating. Those columns predate this table and were
 * admin-editable free text; a product keeps its curated number until its first
 * real review lands, at which point the computed value takes over for good.
 */

export const writeReviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  title: z.string().trim().max(120).optional().nullable(),
  body: z.string().trim().min(10, 'Tell us a little more.').max(4000),
});

/** Reasons a customer can give. Kept short on purpose: a long list makes
 *  people pick the first plausible option, which tells a moderator nothing.
 *  Mirrors the ReviewReportReason enum in schema.prisma. */
export const reportReviewSchema = z.object({
  reason: z.enum(['spam', 'offensive', 'off_topic', 'personal_info', 'not_a_real_purchase']),
  note: z.string().trim().max(500).optional().nullable(),
});

/** Public projection — never leaks the reviewer's email or the order id. */
const publicSelect = {
  id: true,
  rating: true,
  title: true,
  body: true,
  created_at: true,
  updated_at: true,
  user: { select: { id: true, name: true } },
} satisfies Prisma.ProductReviewSelect;

/**
 * Reviews are public, and both documents customers are shown promise only a
 * first name appears next to one — privacy policy §2.4, terms §10. The API
 * used to send `user.name` whole, so "María López Ruiz" sat on a public
 * product page having been told otherwise. Trimmed here rather than in each
 * client, so web, mobile and anything built later cannot leak it by omission,
 * and so an installed app already in someone's hands is fixed by this deploy.
 *
 * An erased account is left alone: its name is already the anonymised marker.
 */
const ERASED_NAME = 'Deleted user';

type ReviewWithUser = { user: { id: string; name: string } };

function withFirstNameOnly<T extends ReviewWithUser>(review: T): T {
  const { name } = review.user;
  if (name === ERASED_NAME) return review;
  return { ...review, user: { ...review.user, name: name.trim().split(/\s+/)[0] || name } };
}

/**
 * Recompute a product's rating aggregate from its visible reviews.
 *
 * MUST run inside the caller's transaction: the aggregate and the row that
 * changed it have to land together, or a crash between them leaves the
 * storefront quoting a rating that no set of reviews supports.
 *
 * With no visible reviews the columns go back to null/0 rather than keeping a
 * stale average — a product whose only review was hidden should read as
 * "no reviews yet", not as whatever that one review said.
 */
async function recomputeProductRating(tx: Prisma.TransactionClient, productId: string): Promise<void> {
  const agg = await tx.productReview.aggregate({
    where: { product_id: productId, is_hidden: false },
    _avg: { rating: true },
    _count: { _all: true },
  });
  const count = agg._count._all;
  await tx.product.update({
    where: { id: productId },
    data: {
      // Round to one decimal: the storefront renders `4.3`, and storing full
      // float precision only invites 4.299999999 in a payload somewhere.
      rating: count > 0 && agg._avg.rating != null
        ? Math.round(agg._avg.rating * 10) / 10
        : null,
      rating_count: count,
    },
  });
}

/**
 * Has this user actually received this product?
 *
 * Delivered only — not merely ordered. Reviewing something still in transit
 * is the most common way fake-review rings operate, and a customer cannot
 * honestly rate what has not arrived. Cancelled and draft orders never
 * qualify. Sub-orders count: their status is their own, which is exactly the
 * state that says this line was delivered.
 */
async function findQualifyingOrderId(userId: string, productId: string): Promise<string | null> {
  const item = await prisma.orderItem.findFirst({
    where: {
      product_id: productId,
      order: { user_id: userId, status: 'delivered', deleted_at: null },
    },
    select: { order_id: true },
    orderBy: { order: { created_at: 'desc' } },
  });
  return item?.order_id ?? null;
}

// ─── GET /api/products/:productId/reviews ───────────────
// Public. Visible reviews, newest first. When a session is present the
// caller's own review is returned separately as `mine` so the client can show
// "edit your review" without scanning the paged list for it.
router.get('/', optionalAuth, asyncHandler(async (req, res) => {
  const productId = req.params.productId;
  const params = parsePage(req.query, 10, 50);

  const where: Prisma.ProductReviewWhereInput = { product_id: productId, is_hidden: false };

  const [items, total, summaryRows, mine] = await Promise.all([
    prisma.productReview.findMany({
      where, select: publicSelect, orderBy: { created_at: 'desc' }, skip: params.skip, take: params.limit,
    }),
    prisma.productReview.count({ where }),
    // Star histogram for the "5★ ▓▓▓ 12" breakdown the product page renders.
    prisma.productReview.groupBy({
      by: ['rating'], where, _count: { _all: true },
    }),
    req.user
      ? prisma.productReview.findUnique({
        where: { product_id_user_id: { product_id: productId, user_id: req.user.userId } },
        select: { ...publicSelect, is_hidden: true },
      })
      : Promise.resolve(null),
  ]);

  const distribution: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const row of summaryRows) {
    const star = row.rating as 1 | 2 | 3 | 4 | 5;
    if (star >= 1 && star <= 5) distribution[star] = row._count._all;
  }
  const sum = ([1, 2, 3, 4, 5] as const).reduce((acc, star) => acc + star * distribution[star], 0);

  return success(res, {
    ...paged(items.map(withFirstNameOnly), total, params),
    summary: {
      average: total > 0 ? Math.round((sum / total) * 10) / 10 : null,
      total,
      distribution,
    },
    mine: mine ? withFirstNameOnly(mine) : null,
  });
}));

// ─── GET /api/products/:productId/reviews/eligibility ───
// Whether the signed-in customer may write here, so the client can show the
// right affordance instead of offering a form that will 403.
router.get('/eligibility', requireAuth, asyncHandler(async (req, res) => {
  const productId = req.params.productId;
  const userId = req.user!.userId;
  const [orderId, existing] = await Promise.all([
    findQualifyingOrderId(userId, productId),
    prisma.productReview.findUnique({
      where: { product_id_user_id: { product_id: productId, user_id: userId } },
      select: { id: true, is_hidden: true },
    }),
  ]);
  return success(res, {
    can_review: orderId !== null,
    has_reviewed: existing !== null,
    // A hidden review still blocks a fresh one — the unique constraint holds —
    // so the client needs to know rather than offering a form that 409s.
    is_hidden: existing?.is_hidden ?? false,
  });
}));

// ─── POST /api/products/:productId/reviews ──────────────
// Create or update the caller's review. Upsert rather than 409-on-duplicate:
// the unique constraint means one review per customer per product, and
// "change my mind" is a normal thing to do.
router.post('/', requireAuth, validate(writeReviewSchema), asyncHandler(async (req, res) => {
  const productId = req.params.productId;
  const userId = req.user!.userId;
  const { rating, title, body } = req.body as z.infer<typeof writeReviewSchema>;

  const product = await prisma.product.findFirst({
    where: { id: productId, is_active: true },
    select: { id: true },
  });
  if (!product) throw new HttpError(404, 'Product not found.');

  const orderId = await findQualifyingOrderId(userId, productId);
  if (!orderId) {
    throw new HttpError(403, 'You can review a product once it has been delivered to you.');
  }

  const review = await prisma.$transaction(async (tx) => {
    const saved = await tx.productReview.upsert({
      where: { product_id_user_id: { product_id: productId, user_id: userId } },
      create: {
        product_id: productId,
        user_id: userId,
        order_id: orderId,
        rating,
        title: title ?? null,
        body,
      },
      // An edit never silently un-hides a moderated review — clearing that is
      // an admin decision, not something the author can undo by resubmitting.
      update: { rating, title: title ?? null, body },
      select: publicSelect,
    });
    await recomputeProductRating(tx, productId);
    return saved;
  });

  return success(res, withFirstNameOnly(review), 201);
}));

// ─── DELETE /api/products/:productId/reviews/mine ───────
router.delete('/mine', requireAuth, asyncHandler(async (req, res) => {
  const productId = req.params.productId;
  const userId = req.user!.userId;

  const existing = await prisma.productReview.findUnique({
    where: { product_id_user_id: { product_id: productId, user_id: userId } },
    select: { id: true },
  });
  if (!existing) throw new HttpError(404, 'You have not reviewed this product.');

  await prisma.$transaction(async (tx) => {
    await tx.productReview.delete({ where: { id: existing.id } });
    await recomputeProductRating(tx, productId);
  });

  return success(res, { message: 'Review removed.' });
}));

// ─── POST /api/products/:productId/reviews/:id/report ───
//
// Google Play's UGC policy requires in-app reporting for publicly visible user
// content, and reviews render on every product page in the app.
//
// A report hides nothing. Letting a flag auto-hide would hand any signed-in
// account a veto over an honest bad review, which is the failure mode this is
// supposed to prevent — hiding stays an admin decision on `is_hidden`.
router.post('/:id/report', requireAuth, validate(reportReviewSchema), asyncHandler(async (req, res) => {
  const productId = req.params.productId;
  const reviewId = req.params.id;
  const userId = req.user!.userId;
  const { reason, note } = req.body as z.infer<typeof reportReviewSchema>;

  // Scoped to the product in the path so a review id from elsewhere cannot be
  // reported through this route.
  const review = await prisma.productReview.findFirst({
    where: { id: reviewId, product_id: productId },
    select: { id: true, user_id: true },
  });
  if (!review) throw new HttpError(404, 'Review not found.');
  if (review.user_id === userId) {
    throw new HttpError(400, 'You cannot report your own review.');
  }

  // Idempotent: a second tap re-states the same report rather than failing.
  // The client cannot tell whether the first one landed, so a 409 here would
  // only ever be shown to someone who already did the right thing.
  await prisma.productReviewReport.upsert({
    where: { review_id_reporter_id: { review_id: reviewId, reporter_id: userId } },
    create: { review_id: reviewId, reporter_id: userId, reason, note: note ?? null },
    // Re-reporting clears a previous dismissal: the reporter is telling us
    // again, after someone had decided it was fine.
    update: { reason, note: note ?? null, dismissed_at: null, dismissed_by_admin_id: null },
    select: { id: true },
  });

  return success(res, { message: 'Thanks — we will take a look.' }, 201);
}));

router.use((err: unknown, _req: any, res: any, next: any) => {
  if (err instanceof HttpError) return error(res, err.message, err.status);
  next(err);
});

export { recomputeProductRating, withFirstNameOnly };
export default router;
