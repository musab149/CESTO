import { Router } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { success, error } from '../../lib/response';
import { asyncHandler } from '../../lib/async';
import { validate } from '../../middleware/validate';
import {
  defaultFor,
  defaultPromoGrid,
  defaultAdsBanner,
  defaultTopBrands,
  defaultShopByOrigin,
  defaultTopShops,
  defaultStoresHero,
  HOME_SECTION_KEYS,
  type HomeSectionKey,
} from '../../lib/homeSectionsDefaults';
import {
  promoGridSchema,
  adsBannerSchema,
  topBrandsSchema,
  shopByOriginSchema,
  topShopsSchema,
  storesHeroSchema,
} from '../../validators/homeSections';

const router = Router();

function isValidKey(key: string): key is HomeSectionKey {
  return (HOME_SECTION_KEYS as readonly string[]).includes(key);
}

/**
 * GET /api/admin/home-sections/:key
 * Same shape as the public endpoint — useful for the admin editor's initial load.
 */
router.get('/:key', asyncHandler(async (req, res) => {
  const key = req.params.key;
  if (!isValidKey(key)) return error(res, `Unknown home section: ${key}`, 404);
  const row = await prisma.homeSection.findUnique({ where: { key } });
  if (row) {
    return success(res, {
      ...(row.config as Record<string, unknown>),
      updated_at: row.updated_at.toISOString(),
    });
  }
  return success(res, defaultFor(key));
}));

/**
 * PUT /api/admin/home-sections/promo-grid
 * Upserts the row with the validated payload.
 */
router.put(
  '/promo-grid',
  validate(promoGridSchema),
  asyncHandler(async (req, res) => {
    // Strip `updated_at` from the stored blob — the DB column owns that field.
    const { updated_at: _drop, ...config } = req.body as Record<string, unknown>;
    const json = config as Prisma.InputJsonValue;
    const row = await prisma.homeSection.upsert({
      where: { key: 'promo-grid' },
      create: { key: 'promo-grid', config: json },
      update: { config: json },
    });
    return success(res, {
      ...(row.config as Record<string, unknown>),
      updated_at: row.updated_at.toISOString(),
    });
  }),
);

/**
 * PUT /api/admin/home-sections/ads-banner
 */
router.put(
  '/ads-banner',
  validate(adsBannerSchema),
  asyncHandler(async (req, res) => {
    const { updated_at: _drop, ...config } = req.body as Record<string, unknown>;
    const json = config as Prisma.InputJsonValue;
    const row = await prisma.homeSection.upsert({
      where: { key: 'ads-banner' },
      create: { key: 'ads-banner', config: json },
      update: { config: json },
    });
    return success(res, {
      ...(row.config as Record<string, unknown>),
      updated_at: row.updated_at.toISOString(),
    });
  }),
);

/**
 * PUT /api/admin/home-sections/top-brands
 */
router.put(
  '/top-brands',
  validate(topBrandsSchema),
  asyncHandler(async (req, res) => {
    const { updated_at: _drop, ...config } = req.body as Record<string, unknown>;
    const json = config as Prisma.InputJsonValue;
    const row = await prisma.homeSection.upsert({
      where: { key: 'top-brands' },
      create: { key: 'top-brands', config: json },
      update: { config: json },
    });
    return success(res, {
      ...(row.config as Record<string, unknown>),
      updated_at: row.updated_at.toISOString(),
    });
  }),
);

/**
 * PUT /api/admin/home-sections/shop-by-origin
 */
router.put(
  '/shop-by-origin',
  validate(shopByOriginSchema),
  asyncHandler(async (req, res) => {
    const { updated_at: _drop, ...config } = req.body as Record<string, unknown>;
    const json = config as Prisma.InputJsonValue;
    const row = await prisma.homeSection.upsert({
      where: { key: 'shop-by-origin' },
      create: { key: 'shop-by-origin', config: json },
      update: { config: json },
    });
    return success(res, {
      ...(row.config as Record<string, unknown>),
      updated_at: row.updated_at.toISOString(),
    });
  }),
);

/**
 * PUT /api/admin/home-sections/top-shops
 */
router.put(
  '/top-shops',
  validate(topShopsSchema),
  asyncHandler(async (req, res) => {
    const { updated_at: _drop, ...config } = req.body as Record<string, unknown>;
    const json = config as Prisma.InputJsonValue;
    const row = await prisma.homeSection.upsert({
      where: { key: 'top-shops' },
      create: { key: 'top-shops', config: json },
      update: { config: json },
    });
    return success(res, {
      ...(row.config as Record<string, unknown>),
      updated_at: row.updated_at.toISOString(),
    });
  }),
);

/**
 * PUT /api/admin/home-sections/stores-hero
 */
router.put(
  '/stores-hero',
  validate(storesHeroSchema),
  asyncHandler(async (req, res) => {
    const { updated_at: _drop, ...config } = req.body as Record<string, unknown>;
    const json = config as Prisma.InputJsonValue;
    const row = await prisma.homeSection.upsert({
      where: { key: 'stores-hero' },
      create: { key: 'stores-hero', config: json },
      update: { config: json },
    });
    return success(res, {
      ...(row.config as Record<string, unknown>),
      updated_at: row.updated_at.toISOString(),
    });
  }),
);

/**
 * DELETE /api/admin/home-sections/:key
 * Restores the row to the baked-in defaults (upsert with the canned blob).
 * "Reset" rather than literal delete so the customer endpoint keeps returning
 * a row with a fresh `updated_at` for cache busting.
 */
router.delete('/:key', asyncHandler(async (req, res) => {
  const key = req.params.key;
  if (!isValidKey(key)) return error(res, `Unknown home section: ${key}`, 404);
  const config =
    key === 'promo-grid' ? defaultPromoGrid
    : key === 'ads-banner' ? defaultAdsBanner
    : key === 'top-brands' ? defaultTopBrands
    : key === 'top-shops' ? defaultTopShops
    : key === 'stores-hero' ? defaultStoresHero
    : defaultShopByOrigin;
  // Strip the seed `updated_at` so the DB stamps its own.
  const { updated_at: _drop, ...rest } = config as Record<string, unknown>;
  const json = rest as Prisma.InputJsonValue;
  const row = await prisma.homeSection.upsert({
    where: { key },
    create: { key, config: json },
    update: { config: json },
  });
  return success(res, {
    ...(row.config as Record<string, unknown>),
    updated_at: row.updated_at.toISOString(),
  });
}));

export default router;
