import { Router, Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { VAT_FIELDS } from '../lib/pricing';
import { customerStoreVisibleProductFilter } from '../lib/store-scope';
import { shownToViewer } from '../lib/audience';
import { stableProductOrder } from '../lib/stable-order';
import { selectNewArrivals } from '../lib/newArrivals';
import { findRelatedProducts } from '../lib/relatedProducts';
import { success, error } from '../lib/response';
import { parsePage, paged } from '../lib/pagination';
import { computeOriginProductCounts } from '../lib/origin-counts';
import { cachedCount } from '../lib/count-cache';
import { setCatalogueCache, stableKey } from '../lib/http-cache';

const router = Router();

const productSelect = {
  id: true,
  name_es: true,
  name_en: true,
  brand: true,
  origin: true,
  brand_id: true,
  origin_id: true,
  // Rich brand/origin objects driven by the new first-class tables. Legacy
  // `brand` and `origin` strings above stay for backward-compat with older
  // frontends during the rollout window.
  brand_ref:  { select: { id: true, name: true, slug: true, logo_url: true, logo_bg: true, link: true } },
  origin_ref: { select: { id: true, key: true, label_es: true, label_en: true, bg_color: true, accent_color: true, image_url: true, link: true } },
  store_id: true,
  store: {
    select: {
      id: true, slug: true, name: true,
      logo_url: true, logo_bg: true, is_verified: true,
    },
  },
  is_featured: true,
  is_sponsored: true,
  is_active: true,
  is_verified: true,
  is_top_seller: true,
  is_quotation_enabled: true,
  // Its IVA: what b2bPricingGuard adds to every price below (lib/pricing),
  // and the band a customer's order editor previews a line added from here at.
  ...VAT_FIELDS,
  rating: true,
  rating_count: true,
  category_id: true,
  subcategory_id: true,
  category: { select: { id: true, name_es: true, name_en: true } },
  subcategory: { select: { id: true, name_es: true, name_en: true } },
  variants: {
    where: { is_active: true },
    select: {
      id: true, name_es: true, name_en: true, price: true,
      compare_at_price: true, b2b_price: true, stock_quantity: true, low_stock_threshold: true,
      is_default: true, sku: true,
    },
    orderBy: { is_default: 'desc' as const },
  },
  images: {
    select: { id: true, url: true, alt_text: true, is_primary: true },
    orderBy: { sort_order: 'asc' as const },
  },
};

/**
 * Compat mapper — surfaces the old `shop_id` string alongside the new
 * `store_id` UUID + `store` relation, so frontends deployed before the API
 * still resolve products to their partner shop during the in-flight window.
 * (defends per feedback_deploy-shape-skew memory)
 */
type ProductWithStore = { store?: { slug: string } | null } & Record<string, unknown>;
export const withShopCompat = <T extends ProductWithStore>(p: T): T & { shop_id: string | null } => ({
  ...p,
  shop_id: p.store?.slug ?? null,
});

// ─── GET /api/products ──────────────────────────────────
// Generic paginated listing for the home page, the category pages and the
// rashan pack builder's product picker.
//
// Filterable by `q` (free text), category / subcategory / productType, store,
// brand, origin, and the sponsored / newArrival curation flags.
//
// `limit` is capped at 60 by parsePage. Callers that need the whole catalogue
// page through it — asking for `limit: 200` silently yields 60, which is what
// made the pack builder report a 60-product catalogue.

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Only what this customer's kind is shown: B2C, B2B or both (lib/audience).
    const shown = await shownToViewer(req);
    const params = parsePage(req.query, 24, 60);
    const { q, categoryId, subcategoryId, productTypeId, storeId, sort, origin, brand, sponsored, newArrival } = req.query as Record<string, string | undefined>;

    const where: Prisma.ProductWhereInput = { is_active: true, ...customerStoreVisibleProductFilter, ...shown };
    if (categoryId) where.category_id = categoryId;
    if (subcategoryId) where.subcategory_id = subcategoryId;
    if (productTypeId) where.product_type_id = productTypeId;
    // `cesto` is the sentinel for the house catalogue. Those products carry
    // store_id = NULL rather than a Store row, so there is no id to pass and
    // a caller otherwise has no way to ask for them specifically.
    if (storeId) where.store_id = storeId === 'cesto' ? null : storeId;
    if (origin) where.origin = { equals: origin, mode: 'insensitive' };
    if (brand) where.brand = { equals: brand, mode: 'insensitive' };
    // Free-text search. Matches the same three columns as the storefront's own
    // search (`/api/stores/:slug/products`) so a shopper gets the same hits
    // whichever surface they type into.
    //
    // Assigned as `where.AND` rather than `where.OR`: `origin`/`brand` above
    // already occupy top-level keys, and a later `OR` would be a second
    // top-level branch that WIDENS the result set instead of narrowing it —
    // searching would then return more rows than not searching.
    if (q && q.trim()) {
      const term = q.trim();
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
        {
          OR: [
            { name_es: { contains: term, mode: 'insensitive' } },
            { name_en: { contains: term, mode: 'insensitive' } },
            { brand:   { contains: term, mode: 'insensitive' } },
          ],
        },
      ];
    }
    // Accept "true" or "1" — the home CTA links to /categories?sponsored=1.
    if (sponsored === 'true' || sponsored === '1') where.is_sponsored = true;

    // Home "New products" rail. This is not a plain filter: an admin curates
    // the rail with is_new_arrival, and when they have curated little or
    // nothing it is topped up with recent, sellable, DIVERSIFIED products —
    // see lib/newArrivals.ts for why a naive created_at fallback is the wrong
    // answer on a bulk-imported catalogue.
    //
    // Handled before the generic filter block returns because the rail needs
    // two queries and its own ordering, and because a flat `total` is
    // meaningless for it. `total` is reported as the number of rows returned
    // so a caller paging this by accident stops after one page instead of
    // walking a count it can never reach.
    if (newArrival === 'true' || newArrival === '1') {
      const items = await selectNewArrivals({ limit: params.limit, select: productSelect, shown });
      // Same treatment as the generic path below: `withShopCompat` so older
      // frontends still resolve a product to its shop, and the same private
      // cache header, since b2bPricingGuard rewrites price per viewer.
      setCatalogueCache(res);
      return success(res, paged(items.map(withShopCompat), items.length, params));
    }

    let orderBy: Prisma.ProductOrderByWithRelationInput = { created_at: 'desc' };
    if (sort === 'name_asc') orderBy = { name_es: 'asc' };
    if (sort === 'newest')   orderBy = { created_at: 'desc' };
    // Reviews as the popularity proxy, matching what the storefront's own
    // 'popular' sort already does. Added because the homepage's New and
    // Popular rails were both falling back to created_at desc — the same
    // twelve products under two headings.
    if (sort === 'popular')  orderBy = { rating_count: 'desc' };
    // price-based sorting is best-effort here; full price sort lives in /categories/:id/products

    // The count is memoised because it is O(whole catalogue) and identical
    // across every anonymous visitor, while the rows are always read live.
    // See lib/count-cache.ts for the latency measurements behind this.
    const [products, total] = await Promise.all([
      prisma.product.findMany({ where, select: productSelect, orderBy: stableProductOrder(orderBy), skip: params.skip, take: params.limit }),
      cachedCount(`products:${stableKey(where)}`, () => prisma.product.count({ where })),
    ]);

    // Catalogue listings are safe to reuse for a short window, but NOT in a
    // shared cache: b2bPricingGuard rewrites `price` per viewer, so a proxy
    // holding one copy could serve wholesale prices to a retail shopper.
    // `private` keeps it in the requesting browser only.
    setCatalogueCache(res);
    return success(res, paged(products.map(withShopCompat), total, params));
  } catch (err) { next(err); }
});

// ─── GET /api/origins/counts ───────────────────────────
// Public — active + customer-visible product counts keyed by `origins.key`
// so the "Shop by Origin" cards on the homepage/categories can render real
// badges. Uses the shared helper so admin + customer surfaces cannot
// silently drift apart (they used to — see origin-counts.ts).

router.get('/origins/counts', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Only what this customer's kind is shown: B2C, B2B or both (lib/audience).
    const shown = await shownToViewer(req);
    const [origins, countsById] = await Promise.all([
      prisma.origin.findMany({
        where: { is_active: true },
        select: { id: true, key: true },
      }),
      computeOriginProductCounts({
        is_active: true,
        ...customerStoreVisibleProductFilter, ...shown,
      }),
    ]);
    const counts = origins.map((o) => ({
      key: o.key.toLowerCase(),
      product_count: countsById.get(o.id) ?? 0,
    }));
    return success(res, counts);
  } catch (err) { next(err); }
});

// ─── GET /api/products/brands/counts ───────────────────
// Public — mirror of origins/counts for brand discovery. Keyed by the exact
// brand name on Product.brand (case preserved) so the customer-side filter
// link `?brand=X` matches the catalogue without further normalisation.

router.get('/brands/counts', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Only what this customer's kind is shown: B2C, B2B or both (lib/audience).
    const shown = await shownToViewer(req);
    const rows = await prisma.product.groupBy({
      by: ['brand'],
      where: { brand: { not: null }, is_active: true, ...customerStoreVisibleProductFilter, ...shown },
      _count: { _all: true },
    });
    const counts = rows
      .filter((r) => r.brand && r.brand.trim().length > 0)
      .map((r) => ({ name: r.brand as string, product_count: r._count._all }));
    return success(res, counts);
  } catch (err) { next(err); }
});

// ─── GET /api/products/by-ids?ids=uuid1,uuid2,... ───────
// Public — fetch a specific set of products by id. Ordering follows the
// order of the ids query so callers (favorites, cart, recently-viewed)
// can preserve their local ordering without a client-side re-sort.
// Capped at 100 ids per call — the customer app should never need more.

router.get('/by-ids', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Only what this customer's kind is shown: B2C, B2B or both (lib/audience).
    const shown = await shownToViewer(req);
    const raw = typeof req.query.ids === 'string' ? req.query.ids : '';
    // Only accept well-formed UUIDs — anything else would blow up Prisma
    // with P2023. Malformed ids get silently dropped instead of 500ing,
    // so a stale favourite id from the client can't break the whole call.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const ids = raw.split(',').map((s) => s.trim()).filter((s) => UUID_RE.test(s));
    if (ids.length === 0) return success(res, []);
    if (ids.length > 100) return error(res, 'Too many ids (max 100 per request).', 400);

    const rows = await prisma.product.findMany({
      where: { id: { in: ids }, is_active: true, ...customerStoreVisibleProductFilter, ...shown },
      select: productSelect,
    });
    // Preserve the caller's requested order — Prisma's `in` doesn't sort.
    const byId = new Map(rows.map((r) => [r.id, r]));
    const ordered = ids.map((id) => byId.get(id)).filter((r): r is NonNullable<typeof r> => Boolean(r));
    return success(res, ordered.map(withShopCompat));
  } catch (err) { next(err); }
});

// ─── GET /api/products/featured ─────────────────────────

router.get('/featured', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Only what this customer's kind is shown: B2C, B2B or both (lib/audience).
    const shown = await shownToViewer(req);
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);

    // Prioritise admin-curated featured products, then fill the slate with the
    // most recently added active products. Means a fresh storefront with zero
    // featured items still has *something* on the homepage instead of an empty
    // rail — and as soon as an admin flips a product's Featured toggle, it
    // jumps to the top.
    const products = await prisma.product.findMany({
      where: { is_active: true, ...customerStoreVisibleProductFilter, ...shown },
      select: productSelect,
      take: limit,
      orderBy: [{ is_featured: 'desc' }, { created_at: 'desc' }],
    });

    return success(res, products.map(withShopCompat));
  } catch (err) { next(err); }
});

// ─── GET /api/products/sponsored ───────────────────────
// Admin-curated paid placements. Falls back to featured products if no
// product has been flagged sponsored yet, so the home rail is never empty.

router.get('/sponsored', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Only what this customer's kind is shown: B2C, B2B or both (lib/audience).
    const shown = await shownToViewer(req);
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);

    const sponsored = await prisma.product.findMany({
      where: { is_active: true, is_sponsored: true, ...customerStoreVisibleProductFilter, ...shown },
      select: productSelect,
      take: limit,
      orderBy: { created_at: 'desc' },
    });

    if (sponsored.length >= limit) return success(res, sponsored);

    // Pad with featured products (excluding any already in the sponsored list)
    // so the rail looks alive before the admin flags products.
    const seen = new Set(sponsored.map((p) => p.id));
    const padding = await prisma.product.findMany({
      where: { is_active: true, is_featured: true, id: { notIn: Array.from(seen) }, ...customerStoreVisibleProductFilter, ...shown },
      select: productSelect,
      take: limit - sponsored.length,
      orderBy: { created_at: 'desc' },
    });

    return success(res, [...sponsored, ...padding].map(withShopCompat));
  } catch (err) { next(err); }
});

// ─── GET /api/products/:id ──────────────────────────────

// ─── GET /api/products/:id/related ──────────────────────
// "You might also like" on the product page. Tiered: the same product from
// another shop first, then the nearest taxonomy — see lib/relatedProducts.ts
// for why that order. Its own endpoint rather than a field on the product,
// because the product page can paint without it and it is a handful of
// queries rather than one.

router.get('/:id/related', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Only what this customer's kind is shown: B2C, B2B or both (lib/audience).
    const shown = await shownToViewer(req);
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '8'), 10) || 8, 1), 24);

    const product = await prisma.product.findFirst({
      where: { id: req.params.id, is_active: true, ...customerStoreVisibleProductFilter, ...shown },
      select: {
        id: true, name_es: true, brand: true, store_id: true,
        category_id: true, subcategory_id: true, product_type_id: true,
      },
    });
    // A hidden or missing product has no neighbours to offer. Empty rather
    // than 404: the row simply does not render, and the page is already up.
    if (!product) return success(res, { items: [] });

    const items = await findRelatedProducts({ product, limit, select: productSelect, shown });

    setCatalogueCache(res);
    return success(res, { items: items.map((p) => ({ ...withShopCompat(p), related_reason: p.related_reason })) });
  } catch (err) { next(err); }
});

router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Only what this customer's kind is shown: B2C, B2B or both (lib/audience).
    const shown = await shownToViewer(req);
    const product = await prisma.product.findFirst({
      where: { id: req.params.id, is_active: true, ...customerStoreVisibleProductFilter, ...shown },
      select: {
        ...productSelect,
        description_es: true,
        description_en: true,
      },
    });

    if (!product) return error(res, 'Product not found.', 404);
    return success(res, withShopCompat(product));
  } catch (err) { next(err); }
});

export default router;
