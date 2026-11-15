import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { success, error } from '../../lib/response';
import { asyncHandler } from '../../lib/async';
import { parsePage, paged } from '../../lib/pagination';
import { VAT_FIELDS } from '../../lib/pricing';
import { buildProductWhere } from '../../lib/product-filters';
import { customerVisibleStoreFilter } from '../../lib/store-scope';
import { B2B_SIZE, businessProductScope, withBusinessScope } from '../../lib/businessCatalogue';
import { selectNewArrivals } from '../../lib/newArrivals';

/**
 * The business panel's Catálogo (2026-10-29, user: "In catalog we will have
 * the stores, brands, origin, and categories as we have on reps").
 *
 * The rep catalogue's shapes (routes/sales/catalogue.ts), so the panel's
 * browse cards read the same fields — but over a different set of products:
 * not one rep's shops, everything the shop shows a business that has a
 * wholesale price (lib/businessCatalogue). Every count on a card is the number
 * of those products behind it, so no card opens onto nothing.
 *
 * PRICES are not computed here. Mounted behind b2bPricingGuard, like every
 * customer catalogue route: each size goes out with its `b2b_price`, and the
 * guard rewrites `price` to it (the retail price does not go out at all) and
 * takes off any price agreed with this customer — the same rule checkout
 * charges by (lib/pricing effectiveUnitPrice), so the price shown is the price
 * paid. requireBusiness has already put the account on wholesale.
 */

const router = Router();

/** The listing's filters: a subset of the shop's, each one only ever narrowing. */
const listQuerySchema = z.object({
  q: z.string().max(200).optional(),
  categoryId: z.string().uuid().optional(),
  subcategoryId: z.string().uuid().optional(),
  storeId: z.union([z.literal('cesto'), z.string().uuid()]).optional(),
  brandId: z.string().uuid().optional(),
  originId: z.string().uuid().optional(),
  stock: z.enum(['in']).optional(),
  sort: z.enum(['newest', 'name_asc', 'name_desc']).optional(),
});

/** What a product card and the product page read. */
const PRODUCT_SELECT = {
  id: true, name_es: true, name_en: true, brand: true, brand_id: true,
  origin: true, origin_id: true, store_id: true, category_id: true, subcategory_id: true,
  is_new_arrival: true, is_top_seller: true, is_quotation_enabled: true,
  rating: true, rating_count: true, created_at: true,
  // Its IVA: what b2bPricingGuard adds to every price below (lib/pricing),
  // and the band the edit screen's breakdown puts a line just added in.
  ...VAT_FIELDS,
  category: { select: { id: true, name_es: true, name_en: true } },
  store: { select: { id: true, slug: true, name: true, logo_url: true, logo_bg: true } },
  brand_ref: { select: { id: true, name: true, slug: true, logo_url: true, logo_bg: true } },
  origin_ref: { select: { id: true, key: true, label_es: true, label_en: true } },
  // Only the sizes with a wholesale price: the others would be charged retail.
  variants: {
    where: B2B_SIZE,
    orderBy: [{ is_default: 'desc' }, { created_at: 'asc' }] as const,
    select: {
      id: true, name_es: true, name_en: true, sku: true, is_default: true,
      price: true, b2b_price: true, compare_at_price: true,
      stock_quantity: true, low_stock_threshold: true,
    },
  },
  images: { where: { is_primary: true }, select: { url: true }, take: 1 },
} satisfies Prisma.ProductSelect;

// ─── GET /api/business/catalogue/products ─────────────────
router.get('/products', asyncHandler(async (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return error(res, parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '), 422);
  }
  const { sort, ...filters } = parsed.data;
  const params = parsePage(req.query, 24, 60);
  const where = withBusinessScope(buildProductWhere(filters));

  let orderBy: Prisma.ProductOrderByWithRelationInput | Prisma.ProductOrderByWithRelationInput[];
  switch (sort) {
    case 'name_asc':  orderBy = [{ name_es: 'asc' }, { name_en: 'asc' }]; break;
    case 'name_desc': orderBy = [{ name_es: 'desc' }, { name_en: 'desc' }]; break;
    case 'newest':
    default:          orderBy = [{ created_at: 'desc' }, { id: 'asc' }]; break;
  }

  const [products, total] = await Promise.all([
    prisma.product.findMany({ where, select: PRODUCT_SELECT, orderBy, skip: params.skip, take: params.limit }),
    prisma.product.count({ where }),
  ]);
  return success(res, paged(products, total, params));
}));

// ─── GET /api/business/catalogue/new ──────────────────────
// The home's "new in your catalogue" rail (2026-10-31, user: the home should
// "keep them updated"). The shop's own new-arrivals pick (lib/newArrivals:
// what an admin flagged first, then recent products spread across categories
// so one import cannot fill it), over the business catalogue.
router.get('/new', asyncHandler(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 12, 1), 24);
  return success(res, await selectNewArrivals({ limit, select: PRODUCT_SELECT, shown: businessProductScope }));
}));

// ─── GET /api/business/catalogue/usuals ───────────────────
// "What you order most" on the home: the products this business bought in
// the most orders over the last 120 days (then the most units), that it can
// still buy here — a quick way back to a weekly order. Cancelled orders do
// not count.
const USUALS_DAYS = 120;
router.get('/usuals', asyncHandler(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 12, 1), 24);
  const since = new Date(Date.now() - USUALS_DAYS * 24 * 60 * 60 * 1000);
  const rows = await prisma.orderItem.groupBy({
    by: ['product_id'],
    where: {
      order: {
        user_id: req.business!.user.id,
        deleted_at: null,
        status: { in: ['pending', 'confirmed', 'preparing', 'on_the_way', 'delivered'] },
        created_at: { gte: since },
      },
    },
    _count: { _all: true },
    _sum: { quantity: true },
    orderBy: [{ _count: { product_id: 'desc' } }, { _sum: { quantity: 'desc' } }],
    take: limit * 2,
  });
  if (rows.length === 0) return success(res, []);
  // Some may have left the catalogue since (no wholesale price, shop paused).
  const products = await prisma.product.findMany({
    where: { AND: [{ id: { in: rows.map((r) => r.product_id) } }, businessProductScope] },
    select: PRODUCT_SELECT,
  });
  const byId = new Map(products.map((p) => [p.id, p]));
  return success(res, rows.map((r) => byId.get(r.product_id)).filter((p): p is NonNullable<typeof p> => !!p).slice(0, limit));
}));

// ─── GET /api/business/catalogue/products/:id ─────────────
// The product page: every picture, the description, the wholesale sizes. A
// product outside the business catalogue is "not found" — the same answer as
// one that does not exist, since this panel offers nothing else.
router.get('/products/:id', asyncHandler(async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) return error(res, 'Product not found.', 404);
  const product = await prisma.product.findFirst({
    where: { AND: [{ id: id.data }, businessProductScope] },
    select: {
      ...PRODUCT_SELECT,
      description_es: true, description_en: true,
      images: { select: { url: true, is_primary: true, sort_order: true }, orderBy: [{ is_primary: 'desc' }, { sort_order: 'asc' }] },
    },
  });
  if (!product) return error(res, 'Product not found.', 404);
  return success(res, product);
}));

// ─── The browse cards ─────────────────────────────────────

/** How many catalogue products sit under each value of one column. */
async function countsBy(by: 'brand_id' | 'origin_id' | 'store_id' | 'category_id'): Promise<Map<string | null, number>> {
  const rows = await prisma.product.groupBy({ by: [by], where: businessProductScope, _count: { _all: true } });
  return new Map(rows.map((g) => [g[by], g._count._all]));
}

router.get('/categories', asyncHandler(async (_req, res) => {
  const [categories, counts] = await Promise.all([
    prisma.category.findMany({
      // Approved as well as active: a partner's category awaiting review is
      // not something to buy from yet.
      where: { is_active: true, approval_status: 'approved' },
      select: { id: true, name_es: true, name_en: true, icon_url: true, bg_color: true, accent_color: true, sort_order: true },
      orderBy: { sort_order: 'asc' },
    }),
    countsBy('category_id'),
  ]);
  return success(res, categories
    .map((c) => ({ ...c, products: counts.get(c.id) ?? 0 }))
    .filter((c) => c.products > 0));
}));

router.get('/brands', asyncHandler(async (_req, res) => {
  const [brands, counts] = await Promise.all([
    prisma.brand.findMany({
      where: { is_active: true },
      select: { id: true, name: true, slug: true, logo_url: true, logo_bg: true, sort_order: true },
      orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
    }),
    countsBy('brand_id'),
  ]);
  return success(res, brands
    .map((b) => ({ ...b, products: counts.get(b.id) ?? 0 }))
    .filter((b) => b.products > 0));
}));

router.get('/origins', asyncHandler(async (_req, res) => {
  const [origins, counts] = await Promise.all([
    prisma.origin.findMany({
      where: { is_active: true },
      select: {
        id: true, key: true, label_es: true, label_en: true,
        bg_color: true, accent_color: true, image_url: true, sort_order: true,
      },
      orderBy: [{ sort_order: 'asc' }, { label_es: 'asc' }],
    }),
    countsBy('origin_id'),
  ]);
  return success(res, origins
    .map((o) => ({ ...o, products: counts.get(o.id) ?? 0 }))
    .filter((o) => o.products > 0));
}));

/**
 * The shops with something in the business catalogue, and Cesto's own
 * (`house`, which has no Store row: its products have none).
 */
router.get('/stores', asyncHandler(async (_req, res) => {
  const counts = await countsBy('store_id');
  const ids = [...counts.keys()].filter((k): k is string => !!k);
  const stores = ids.length === 0 ? [] : await prisma.store.findMany({
    where: { id: { in: ids }, ...customerVisibleStoreFilter },
    select: {
      id: true, slug: true, name: true, logo_url: true, logo_bg: true, is_verified: true,
      cover_url: true, tagline_es: true, tagline_en: true, shop_hours: true,
    },
    orderBy: { name: 'asc' },
  });
  return success(res, {
    items: stores.map((s) => ({ ...s, products: counts.get(s.id) ?? 0 })),
    house: { products: counts.get(null) ?? 0 },
  });
}));

export default router;
