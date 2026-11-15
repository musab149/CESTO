import { Router } from 'express';
import prisma from '../lib/prisma';
import { success, error } from '../lib/response';
import { asyncHandler } from '../lib/async';

const router = Router();

// ─── GET /api/origins ───────────────────────────────────
// Public list of ACTIVE origins, ordered for the customer "Shop by Origin"
// rail. Same call site pattern as /api/brands.

router.get('/', asyncHandler(async (_req, res) => {
  const origins = await prisma.origin.findMany({
    where: { is_active: true },
    orderBy: [{ sort_order: 'asc' }, { label_es: 'asc' }],
    select: {
      id: true,
      key: true,
      label_es: true,
      label_en: true,
      bg_color: true,
      accent_color: true,
      image_url: true,
      link: true,
      sort_order: true,
    },
  });
  return success(res, origins);
}));

// ─── GET /api/origins/:key ──────────────────────────────

router.get('/:key', asyncHandler(async (req, res) => {
  const origin = await prisma.origin.findUnique({
    where: { key: req.params.key },
    select: {
      id: true,
      key: true,
      label_es: true,
      label_en: true,
      bg_color: true,
      accent_color: true,
      image_url: true,
      link: true,
      is_active: true,
    },
  });
  if (!origin || !origin.is_active) return error(res, 'Origin not found.', 404);
  return success(res, origin);
}));

export default router;
