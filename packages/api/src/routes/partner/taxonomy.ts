import { Router } from 'express';
import { z } from 'zod';
import prisma from '../../lib/prisma';
import { success, error } from '../../lib/response';
import { asyncHandler } from '../../lib/async';

const router = Router();

/**
 * Partner-scoped taxonomy endpoints. Most of these mirror the PUBLIC
 * customer-web equivalents (categories / subcategories / product types /
 * brands / origins) but live under `/api/partner/*` so the partner UI never
 * has to reach into another app's URL space. Each is
 * requirePartnerRole()-gated at the mount point — anonymous callers get
 * 401 / 403 rather than the public 200 the customer endpoints serve.
 *
 * The rows themselves ARE the platform-wide taxonomy — a partner picks FROM
 * the curated global list. Subcategories, product types, brands, and origins
 * stay admin-only to write. Categories are the one exception (see Ground
 * Rule 9 carve-out in docs/MULTIVENDOR_ROADMAP.md): a partner may submit a
 * new category, but it starts `approval_status: 'pending'` and is invisible
 * everywhere (including the picker below) until an admin approves it.
 */

const imageUrlSchema = z
  .string()
  .min(1)
  .refine(
    (s) => /^(https?:\/\/|\/|data:|blob:)/.test(s),
    { message: 'Must be a URL or a server path starting with /' },
  );

const hexColorSchema = z
  .string()
  .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/, {
    message: 'Must be a hex color like #FEEFE3',
  });

const categorySubmissionSchema = z.object({
  name_es: z.string().min(1),
  name_en: z.string().min(1),
  icon_url: imageUrlSchema.nullable().optional(),
  bg_color: hexColorSchema.nullable().optional(),
  accent_color: hexColorSchema.nullable().optional(),
});

// ─── Categories ─────────────────────────────────────────

router.get('/categories', asyncHandler(async (_req, res) => {
  const cats = await prisma.category.findMany({
    where: { is_active: true, approval_status: 'approved' },
    orderBy: [{ sort_order: 'asc' }, { name_es: 'asc' }],
    select: {
      id: true, name_es: true, name_en: true, icon_url: true,
      sort_order: true, is_active: true,
    },
  });
  return success(res, cats);
}));

// POST /api/partner/taxonomy/categories
// Submits a new category for admin review. store_id/user_id are forced from
// the JWT — never trusted from the body, same pattern as partner/products.ts.
// Lands as pending + inactive; invisible on GET /categories (and every other
// picker/public read) until an admin approves it from the Cesto panel.
router.post('/categories', asyncHandler(async (req, res) => {
  const parsed = categorySubmissionSchema.safeParse(req.body);
  if (!parsed.success) return error(res, parsed.error.errors[0]?.message ?? 'Invalid category.', 422);

  const created = await prisma.category.create({
    data: {
      ...parsed.data,
      source: 'partner',
      approval_status: 'pending',
      is_active: false,
      submitted_by_store_id: req.partnerRole!.store.id,
      submitted_by_user_id: req.partnerRole!.user.id,
    },
  });
  return success(res, created, 201);
}));

// GET /api/partner/taxonomy/categories/mine
// This store's own submissions, any status, so the partner can track review
// progress without them polluting the picker above. Excludes ones the
// partner has already dismissed (see POST .../dismiss below) — the
// Category itself is untouched either way.
router.get('/categories/mine', asyncHandler(async (req, res) => {
  const mine = await prisma.category.findMany({
    where: {
      submitted_by_store_id: req.partnerRole!.store.id,
      source: 'partner',
      submission_dismissed_at: null,
    },
    orderBy: { created_at: 'desc' },
    select: {
      id: true, name_es: true, name_en: true, icon_url: true,
      approval_status: true, rejection_reason: true, created_at: true, reviewed_at: true,
    },
  });
  return success(res, mine);
}));

// POST /api/partner/taxonomy/categories/:id/dismiss
// Clears one of this store's own submissions from the "My category
// requests" list — a read-state flag only, not a delete. Works regardless
// of status (pending/approved/rejected); 404s if the category isn't a
// pending-or-reviewed submission owned by this store, so a partner can't
// probe other stores' rows by id.
router.post('/categories/:id/dismiss', asyncHandler(async (req, res) => {
  const existing = await prisma.category.findUnique({ where: { id: req.params.id } });
  if (!existing || existing.source !== 'partner' || existing.submitted_by_store_id !== req.partnerRole!.store.id) {
    return error(res, 'Category submission not found.', 404);
  }
  await prisma.category.update({
    where: { id: req.params.id },
    data: { submission_dismissed_at: new Date() },
  });
  return success(res, { message: 'Dismissed.' });
}));

// ─── Subcategories ──────────────────────────────────────

router.get('/subcategories', asyncHandler(async (req, res) => {
  const parsed = z.object({ categoryId: z.string().uuid().optional() }).safeParse(req.query);
  if (!parsed.success) return error(res, 'Invalid categoryId.', 422);

  const subs = await prisma.subCategory.findMany({
    where: {
      is_active: true,
      ...(parsed.data.categoryId ? { category_id: parsed.data.categoryId } : {}),
    },
    orderBy: [{ sort_order: 'asc' }, { name_es: 'asc' }],
    select: {
      id: true, category_id: true, name_es: true, name_en: true,
      sort_order: true, is_active: true,
    },
  });
  return success(res, subs);
}));

// ─── Product types ──────────────────────────────────────

router.get('/product-types', asyncHandler(async (req, res) => {
  const parsed = z.object({ subcategoryId: z.string().uuid() }).safeParse(req.query);
  if (!parsed.success) return error(res, 'subcategoryId is required.', 422);

  const types = await prisma.productType.findMany({
    where: { is_active: true, subcategory_id: parsed.data.subcategoryId },
    orderBy: [{ sort_order: 'asc' }, { name_es: 'asc' }],
    select: {
      id: true, subcategory_id: true, name_es: true, name_en: true,
      sort_order: true, is_active: true,
    },
  });
  return success(res, types);
}));

// ─── Brands ─────────────────────────────────────────────

router.get('/brands', asyncHandler(async (_req, res) => {
  const brands = await prisma.brand.findMany({
    where: { is_active: true },
    orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
    select: {
      id: true, name: true, slug: true, logo_url: true, logo_bg: true,
      sort_order: true, is_active: true,
    },
  });
  return success(res, brands);
}));

// ─── Origins ────────────────────────────────────────────

router.get('/origins', asyncHandler(async (_req, res) => {
  const origins = await prisma.origin.findMany({
    where: { is_active: true },
    orderBy: [{ sort_order: 'asc' }, { label_es: 'asc' }],
    select: {
      id: true, key: true, label_es: true, label_en: true,
      bg_color: true, accent_color: true, image_url: true,
      sort_order: true, is_active: true,
    },
  });
  return success(res, origins);
}));

export default router;
