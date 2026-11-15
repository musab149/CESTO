import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { success, error } from '../../lib/response';
import { asyncHandler } from '../../lib/async';
import { validate } from '../../middleware/validate';
import { parsePage, paged } from '../../lib/pagination';
import { recomputeProductRating } from '../reviews';

/**
 * Review moderation.
 *
 * Reviews are public user-generated content, so there has to be a way to take
 * one down. Deliberately a hide flag rather than an approval queue: requiring
 * a human to approve every review before it appears means reviews stop
 * appearing the first week nobody has time, and the storefront quietly goes
 * back to looking review-less. Hide is the exception path, not the norm.
 *
 * Hidden rows stay in the table — the author still sees their own submission,
 * and support can audit why a decision was made — but they drop out of the
 * public list and out of the rating aggregate.
 *
 * Customer reports (product_review_reports) feed this screen. A report never
 * hides anything by itself — see routes/reviews.ts for why — so this is where
 * one actually gets looked at. "Reported" means at least one report that has
 * not been dismissed; dismissing keeps the rows and stamps them, so a review
 * reported again and again still reads as a pattern rather than resetting to
 * clean each time someone clears it.
 */

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const router = Router();

const hideSchema = z.object({
  reason: z.string().trim().max(300).optional().nullable(),
});

// ─── GET /api/admin/reviews ─────────────────────────────
router.get('/', asyncHandler(async (req, res) => {
  const params = parsePage(req.query, 20, 100);
  const visibility = String(req.query.visibility ?? 'all');
  const q = String(req.query.q ?? '').trim();

  const where: Prisma.ProductReviewWhereInput = {};
  if (visibility === 'hidden') where.is_hidden = true;
  if (visibility === 'visible') where.is_hidden = false;
  // The moderation queue: anything a customer flagged and nobody has cleared.
  if (visibility === 'reported') {
    where.reports = { some: { dismissed_at: null } };
  }
  // Low-star reviews are what a moderator actually goes looking for.
  if (req.query.maxRating) {
    const max = parseInt(String(req.query.maxRating), 10);
    if (Number.isFinite(max)) where.rating = { lte: max };
  }
  if (q) {
    where.OR = [
      { title: { contains: q, mode: 'insensitive' } },
      { body: { contains: q, mode: 'insensitive' } },
      { user: { name: { contains: q, mode: 'insensitive' } } },
      { product: { name_es: { contains: q, mode: 'insensitive' } } },
      { product: { name_en: { contains: q, mode: 'insensitive' } } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.productReview.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip: params.skip,
      take: params.limit,
      select: {
        id: true,
        rating: true,
        title: true,
        body: true,
        is_hidden: true,
        hidden_reason: true,
        hidden_at: true,
        created_at: true,
        updated_at: true,
        order_id: true,
        user: { select: { id: true, name: true, email: true } },
        product: { select: { id: true, name_es: true, name_en: true } },
        // Open reports only. A moderator wants "what is outstanding", and a
        // dismissed report reappearing in the count would make the queue
        // impossible to empty.
        reports: {
          where: { dismissed_at: null },
          orderBy: { created_at: 'desc' },
          select: {
            id: true,
            reason: true,
            note: true,
            created_at: true,
            reporter: { select: { id: true, name: true } },
          },
        },
      },
    }),
    prisma.productReview.count({ where }),
  ]);

  // Flattened onto the row so the table can sort and badge without walking the
  // array, while the array itself stays for the expanded view.
  const rows = items.map((r) => ({
    ...r,
    report_count: r.reports.length,
    last_reported_at: r.reports[0]?.created_at ?? null,
  }));

  return success(res, paged(rows, total, params));
}));

// ─── POST /api/admin/reviews/:id/dismiss-reports ────────
// "I looked, the review stays." Clears the queue entry without touching the
// review. Stamped rather than deleted so a repeat offender is still legible.
router.post('/:id/dismiss-reports', asyncHandler(async (req, res) => {
  const { id } = req.params;

  const existing = await prisma.productReview.findUnique({
    where: { id }, select: { id: true },
  });
  if (!existing) throw new HttpError(404, 'Review not found.');

  const { count } = await prisma.productReviewReport.updateMany({
    where: { review_id: id, dismissed_at: null },
    data: { dismissed_at: new Date(), dismissed_by_admin_id: req.admin?.adminId ?? null },
  });

  return success(res, { id, dismissed: count });
}));

// ─── POST /api/admin/reviews/:id/hide ───────────────────
router.post('/:id/hide', validate(hideSchema), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body as z.infer<typeof hideSchema>;

  const existing = await prisma.productReview.findUnique({
    where: { id }, select: { id: true, product_id: true, is_hidden: true },
  });
  if (!existing) throw new HttpError(404, 'Review not found.');

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.productReview.update({
      where: { id },
      data: {
        is_hidden: true,
        hidden_reason: reason ?? null,
        hidden_at: new Date(),
        hidden_by_admin_id: req.admin?.adminId ?? null,
      },
      select: { id: true, is_hidden: true, hidden_reason: true, hidden_at: true },
    });
    // Same transaction as the flag: the aggregate must never disagree with
    // what is actually visible.
    await recomputeProductRating(tx, existing.product_id);
    return row;
  });

  return success(res, updated);
}));

// ─── POST /api/admin/reviews/:id/unhide ─────────────────
router.post('/:id/unhide', asyncHandler(async (req, res) => {
  const { id } = req.params;

  const existing = await prisma.productReview.findUnique({
    where: { id }, select: { id: true, product_id: true },
  });
  if (!existing) throw new HttpError(404, 'Review not found.');

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.productReview.update({
      where: { id },
      data: { is_hidden: false, hidden_reason: null, hidden_at: null, hidden_by_admin_id: null },
      select: { id: true, is_hidden: true },
    });
    await recomputeProductRating(tx, existing.product_id);
    return row;
  });

  return success(res, updated);
}));

// ─── DELETE /api/admin/reviews/:id ──────────────────────
// Hard delete, for content that must not persist at all (personal data in the
// body, a takedown request). Hiding is the normal action; this is not.
router.delete('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const existing = await prisma.productReview.findUnique({
    where: { id }, select: { id: true, product_id: true },
  });
  if (!existing) throw new HttpError(404, 'Review not found.');

  await prisma.$transaction(async (tx) => {
    await tx.productReview.delete({ where: { id } });
    await recomputeProductRating(tx, existing.product_id);
  });

  return success(res, { message: 'Review deleted.' });
}));

router.use((err: unknown, _req: any, res: any, next: any) => {
  if (err instanceof HttpError) return error(res, err.message, err.status);
  next(err);
});

export default router;
