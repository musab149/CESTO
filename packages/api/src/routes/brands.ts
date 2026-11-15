import { Router } from 'express';
import prisma from '../lib/prisma';
import { success, error } from '../lib/response';
import { asyncHandler } from '../lib/async';

const router = Router();

// ─── GET /api/brands ────────────────────────────────────
// Public list of ACTIVE brands, ordered for the customer Top Brands rail.
// Callers include the homepage marquee and the /brands index page.

router.get('/', asyncHandler(async (_req, res) => {
  const brands = await prisma.brand.findMany({
    where: { is_active: true },
    orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      slug: true,
      logo_url: true,
      logo_bg: true,
      link: true,
      sort_order: true,
    },
  });
  return success(res, brands);
}));

// ─── GET /api/brands/:slug ──────────────────────────────
// Individual brand payload for the /brands/:slug detail page (future) —
// currently unused by the customer web but harmless to expose so the shape
// exists when we get around to building it.

router.get('/:slug', asyncHandler(async (req, res) => {
  const brand = await prisma.brand.findUnique({
    where: { slug: req.params.slug },
    select: {
      id: true,
      name: true,
      slug: true,
      logo_url: true,
      logo_bg: true,
      link: true,
      is_active: true,
    },
  });
  if (!brand || !brand.is_active) return error(res, 'Brand not found.', 404);
  return success(res, brand);
}));

export default router;
