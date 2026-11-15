import { Router } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { success, error } from '../lib/response';
import { asyncHandler } from '../lib/async';
import { parsePage, paged } from '../lib/pagination';
import { VAT_FIELDS } from '../lib/pricing';
import { requireAuth, optionalAuth } from '../middleware/auth';
import { customerVisibleStoreFilter, isStoreCustomerVisible } from '../lib/store-scope';
import { shownToViewer } from '../lib/audience';
import { stableProductOrder } from '../lib/stable-order';

// Inlined open-now check — the shared package's barrel re-exports a .tsx
// component that ts-node-dev in the API can't load, so we duplicate this
// tiny weekday helper rather than crossing the package boundary at runtime.
type ShopHoursDay = { closed: true } | { closed: false; open: string; close: string };
type ShopHoursJson = Partial<Record<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun', ShopHoursDay>>;

/**
 * Whitelist of Store fields safe to serve on PUBLIC endpoints.
 *
 * Both public handlers below fetch the full row because the visibility
 * checks need `status`, `is_test`, `deleted_at` and `deletion_scheduled_at`
 * — but those are internal ops state and must not be serialised. Before
 * this existed, `GET /api/stores` returned the whole row unauthenticated,
 * publishing:
 *
 *   · deletion_reason           — admin-authored free text about a partner
 *                                 business ("non-payment", "fraud suspected").
 *                                 A store in its deletion grace period is
 *                                 still customer-visible, so this really did
 *                                 reach the public payload.
 *   · deletion_scheduled_by_admin_id — an internal admin UUID
 *   · is_test / source / status / sort_order — internal taxonomy
 *
 * Whitelist, not blacklist: a field added to the model is private until
 * someone deliberately lists it here.
 */
const PUBLIC_STORE_FIELDS = [
  'id', 'slug', 'name',
  'tagline_es', 'tagline_en', 'description_es', 'description_en',
  'logo_url', 'logo_bg', 'cover_url',
  'rating', 'rating_count', 'followers_count',
  'is_verified', 'fast_delivery', 'origin',
  // contact_email / contact_phone / website_url are DELIBERATELY absent
  // (2026-07-31). A partner's direct contact details are admin-only: with
  // them in the payload a customer can take the order off the marketplace,
  // and scrapers get a list of every partner's phone and email for free.
  // Hiding them in the UI alone would have left them one devtools tab away.
  'shop_hours', 'created_at',
] as const;

function toPublicStore<T extends Record<string, unknown>>(store: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const key of PUBLIC_STORE_FIELDS) {
    if (key in store) out[key] = store[key as keyof T];
  }
  return out as Partial<T>;
}

function isOpenNow(hours: ShopHoursJson | null | undefined, now: Date = new Date()): boolean {
  if (!hours) return false;
  const map: Record<number, keyof ShopHoursJson> = { 0: 'sun', 1: 'mon', 2: 'tue', 3: 'wed', 4: 'thu', 5: 'fri', 6: 'sat' };
  const day = hours[map[now.getDay()]];
  if (!day || day.closed) return false;
  const parse = (s: string) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
    if (!m) return null;
    const h = parseInt(m[1], 10), min = parseInt(m[2], 10);
    if (h < 0 || h > 24 || min < 0 || min > 59) return null;
    return h * 60 + min;
  };
  const open = parse(day.open), close = parse(day.close);
  if (open === null || close === null) return false;
  const minutes = now.getHours() * 60 + now.getMinutes();
  // Support overnight windows (e.g. 22:00 → 02:00).
  return close > open ? (minutes >= open && minutes < close) : (minutes >= open || minutes < close);
}

const router = Router();

// `Store.country` is still stored and shown on the storefront, but nothing
// filters on it. The catalogue used to narrow to one market via a
// `X-Browse-Country` header and a header picker; both are gone. A customer
// sees every live store.

// ─── GET /api/stores ────────────────────────────────────
// Public listing for the /stores index page. Supports search, origin filter,
// min-rating, and a few common sort orders. Only active stores.

router.get('/', asyncHandler(async (req, res) => {
  const shown = await shownToViewer(req);
  const params = parsePage(req.query, 24, 60);
  const { q, origin, sort } = req.query as Record<string, string | undefined>;
  const minRating = Number.parseFloat((req.query.minRating as string | undefined) ?? '') || undefined;

  const where: Prisma.StoreWhereInput = { is_active: true, ...customerVisibleStoreFilter };
  if (q) {
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { tagline_es: { contains: q, mode: 'insensitive' } },
      { tagline_en: { contains: q, mode: 'insensitive' } },
      { origin: { contains: q, mode: 'insensitive' } },
    ];
  }
  if (origin) where.origin = { equals: origin, mode: 'insensitive' };
  if (minRating && !Number.isNaN(minRating)) where.rating = { gte: minRating };

  let orderBy: Prisma.StoreOrderByWithRelationInput | Prisma.StoreOrderByWithRelationInput[] = [
    { is_verified: 'desc' }, { followers_count: 'desc' }, { sort_order: 'asc' },
  ];
  switch (sort) {
    case 'rating':
      orderBy = [{ rating: 'desc' }, { rating_count: 'desc' }];
      break;
    case 'newest':
      orderBy = { created_at: 'desc' };
      break;
    case 'name':
      orderBy = { name: 'asc' };
      break;
    default:
      // popular = default
      break;
  }

  const [items, total] = await Promise.all([
    prisma.store.findMany({
      where, orderBy, skip: params.skip, take: params.limit,
      include: { _count: { select: { products: { where: { is_active: true, ...shown } } } } },
    }),
    prisma.store.count({ where }),
  ]);

  return success(res, paged(
    items.map(({ _count, ...store }) => ({
      ...toPublicStore(store),
      products_count: _count.products,
      _count,
    })),
    total,
    params,
  ));
}));

// ─── GET /api/stores/:slug ──────────────────────────────
// Public detail. Optionally authed: if a customer JWT is present we surface
// `is_followed`. Also emits a computed `is_open_now` and a per-category
// product count so the storefront's Categories sidebar can render real data.

router.get('/:slug', optionalAuth, asyncHandler(async (req, res) => {
  const slug = req.params.slug;
  // Only what this customer's kind is shown: B2C, B2B or both (lib/audience).
  const shown = await shownToViewer(req);
  const store = await prisma.store.findUnique({
    where: { slug },
    include: { _count: { select: { products: { where: { is_active: true, ...shown } } } } },
  });
  if (!store) return error(res, 'Store not found.', 404);

  // Paused stores get a soft 200 with a distinct `is_paused: true` flag so
  // the customer web can render a "temporarily unavailable" page instead
  // of a hard 404. Only the identity + branding fields (name, logo, cover)
  // ship — no category counts, no follow state, nothing suggesting the
  // store is actually open for business. Everything else stays hidden.
  if (store.status === 'paused'
      && store.is_active
      && !store.deletion_scheduled_at
      && !store.deleted_at) {
    return success(res, {
      slug: store.slug,
      name: store.name,
      logo_url: store.logo_url,
      logo_bg: store.logo_bg,
      cover_url: store.cover_url,
      is_paused: true,
    });
  }

  if (!isStoreCustomerVisible(store)) return error(res, 'Store not found.', 404);

  // Category rollup — one row per category, only counting the store's active
  // products. Small table in practice; group in JS after a single query.
  const groups = await prisma.product.groupBy({
    by: ['category_id'],
    where: { store_id: store.id, is_active: true, ...shown },
    _count: { _all: true },
  });
  let categoryCounts: Array<{
    category_id: string; name_es: string; name_en: string;
    icon_url: string | null; count: number;
  }> = [];
  if (groups.length > 0) {
    const cats = await prisma.category.findMany({
      where: { id: { in: groups.map((g) => g.category_id) } },
      select: { id: true, name_es: true, name_en: true, icon_url: true, sort_order: true },
    });
    const bySortAndName = (a: (typeof cats)[number], b: (typeof cats)[number]) =>
      a.sort_order - b.sort_order || a.name_es.localeCompare(b.name_es);
    categoryCounts = cats.sort(bySortAndName).map((c) => ({
      category_id: c.id,
      name_es: c.name_es,
      name_en: c.name_en,
      icon_url: c.icon_url,
      count: groups.find((g) => g.category_id === c.id)?._count._all ?? 0,
    }));
  }

  // Brand rollup — one row per canonical brand this store actually carries,
  // counting only its active products. Mirrors the category rollup above.
  const brandGroups = await prisma.product.groupBy({
    by: ['brand_id'],
    where: { store_id: store.id, is_active: true, brand_id: { not: null }, ...shown },
    _count: { _all: true },
  });
  let brandCounts: Array<{
    brand_id: string; name: string; slug: string;
    logo_url: string | null; logo_bg: string | null; count: number;
  }> = [];
  if (brandGroups.length > 0) {
    const brands = await prisma.brand.findMany({
      where: { id: { in: brandGroups.map((g) => g.brand_id as string) }, is_active: true },
      select: { id: true, name: true, slug: true, logo_url: true, logo_bg: true, sort_order: true },
    });
    const bySortAndName = (a: (typeof brands)[number], b: (typeof brands)[number]) =>
      a.sort_order - b.sort_order || a.name.localeCompare(b.name);
    brandCounts = brands.sort(bySortAndName).map((b) => ({
      brand_id: b.id,
      name: b.name,
      slug: b.slug,
      logo_url: b.logo_url,
      logo_bg: b.logo_bg,
      count: brandGroups.find((g) => g.brand_id === b.id)?._count._all ?? 0,
    }));
  }

  let isFollowed = false;
  if (req.user) {
    const row = await prisma.storeFollow.findUnique({
      where: { user_id_store_id: { user_id: req.user.userId, store_id: store.id } },
    });
    isFollowed = !!row;
  }

  const { _count, ...bare } = store;
  return success(res, {
    ...toPublicStore(bare),
    products_count: _count.products,
    is_open_now: isOpenNow(store.shop_hours as never),
    is_followed: isFollowed,
    category_counts: categoryCounts,
    brand_counts: brandCounts,
  });
}));

// ─── GET /api/stores/:slug/products ─────────────────────
// Public paginated products for a store. Supports the storefront tabs
// (all / offers / best-sellers / new-arrivals / featured), category filter,
// search, and price/name sort. Mirrors /api/categories/:id/products in shape
// so the customer web can reuse ProductCard.

/**
 * GET /api/stores/:slug/rashan-packs
 *
 * Feeds the "Rashan" tab on the storefront. Deliberately its own endpoint
 * rather than another `tab=` value on /:slug/products — packs are not
 * products, and squeezing them through a paginated product envelope would
 * mean lying about the shape to every existing caller.
 *
 * Only ever this store's own packs, so `admin_blocked_at` is checked
 * directly; the store's visibility was already established above.
 */
router.get('/:slug/rashan-packs', asyncHandler(async (req, res) => {
  const store = await prisma.store.findUnique({
    where: { slug: req.params.slug },
    select: { id: true, is_active: true, deletion_scheduled_at: true, deleted_at: true, status: true, is_test: true },
  });
  if (!store || !isStoreCustomerVisible(store)) return error(res, 'Store not found.', 404);

  const packs = await prisma.rashanPack.findMany({
    where: { store_id: store.id, is_active: true, admin_blocked_at: null },
    orderBy: [{ sort_order: 'asc' }, { name_es: 'asc' }],
  });
  return success(res, packs);
}));

router.get('/:slug/products', asyncHandler(async (req, res) => {
  const slug = req.params.slug;
  const store = await prisma.store.findUnique({
    where: { slug },
    select: { id: true, is_active: true, deletion_scheduled_at: true, deleted_at: true },
  });
  if (!store || !isStoreCustomerVisible(store)) return error(res, 'Store not found.', 404);

  const params = parsePage(req.query, 24, 60);
  const { q, categoryId, subcategoryId, productTypeId, tab, sort, brandId } = req.query as Record<string, string | undefined>;

  const where: Prisma.ProductWhereInput = { store_id: store.id, is_active: true, ...(await shownToViewer(req)) };
  if (categoryId) where.category_id = categoryId;
  // Nested drill-down. Only applied when a category is picked; a stray
  // subcategoryId without categoryId is ignored (would over-filter to
  // subcategory rows across every category, which the sidebar UI can't
  // produce anyway).
  if (subcategoryId && categoryId) where.subcategory_id = subcategoryId;
  // Third-tier drill-down. Same reasoning — productTypeId only kicks in
  // when its parent subcategoryId is present.
  if (productTypeId && subcategoryId && categoryId) where.product_type_id = productTypeId;
  // Orthogonal to the category drill-down — Prisma ANDs top-level where keys,
  // so a brand filter composes with category/tab/search rather than replacing it.
  if (brandId) where.brand_id = brandId;
  if (q) {
    where.OR = [
      { name_es: { contains: q, mode: 'insensitive' } },
      { name_en: { contains: q, mode: 'insensitive' } },
      { brand:   { contains: q, mode: 'insensitive' } },
    ];
  }
  switch (tab) {
    case 'best-sellers':
      // Ranked by how many times the product has actually been ordered, not
      // by the is_top_seller admin flag. Requiring at least one order is what
      // makes the tab mean something — without it the tab is just "all
      // products, ordered by zero".
      where.order_items = { some: {} };
      break;
    case 'featured':
      where.is_featured = true;
      break;
    case 'offers':
      // A variant with a compare_at_price is a variant showing a struck-through
      // "was" price, which is what a shopper reads as a discount.
      // compare_at_price > price cannot be expressed as a Prisma filter (no
      // column-to-column comparison), so a row where an admin set the two
      // equal would slip through. That is a data-entry problem, not a query
      // one, and it is rare enough not to justify raw SQL here.
      where.variants = { some: { compare_at_price: { not: null }, is_active: true } };
      break;
    case 'new-arrivals': {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      where.created_at = { gte: thirtyDaysAgo };
      break;
    }
    case 'all':
    default:
      break;
  }

  // Prisma's typed OrderBy doesn't cover the `variants._min.price` shape used
  // by the categories route; keep it `any` to match that pattern.
  let orderBy: any = { created_at: 'desc' };
  switch (sort) {
    case 'price_asc':  orderBy = { variants: { _min: { price: 'asc' } } }; break;
    case 'price_desc': orderBy = { variants: { _min: { price: 'desc' } } }; break;
    case 'name_asc':   orderBy = { name_es: 'asc' }; break;
    case 'popular':    orderBy = { rating_count: 'desc' }; break;
  }

  // Tab-native ordering, applied only while the shopper is on the default
  // sort. Picking Price or Name explicitly has to win over the tab's own idea
  // of order, but leaving 'popular' (rating_count) on the best-sellers tab
  // would rank by reviews on a tab that is supposed to rank by sales.
  if (!sort || sort === 'popular') {
    if (tab === 'best-sellers') orderBy = { order_items: { _count: 'desc' } };
    if (tab === 'new-arrivals') orderBy = { created_at: 'desc' };
  }

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where, orderBy: stableProductOrder(orderBy), skip: params.skip, take: params.limit,
      select: {
        id: true, name_es: true, name_en: true, brand: true, origin: true,
        brand_id: true, origin_id: true,
        brand_ref:  { select: { id: true, name: true, slug: true, logo_url: true, logo_bg: true, link: true } },
        origin_ref: { select: { id: true, key: true, label_es: true, label_en: true, bg_color: true, accent_color: true, image_url: true, link: true } },
        store_id: true, is_featured: true, is_sponsored: true, is_active: true,
        is_verified: true, is_top_seller: true, is_quotation_enabled: true, rating: true, rating_count: true,
        category_id: true, subcategory_id: true, created_at: true, updated_at: true,
        description_es: true, description_en: true,
        // Its IVA, which b2bPricingGuard adds to every price below (lib/pricing).
        ...VAT_FIELDS,
        store: { select: { id: true, slug: true, name: true, logo_url: true, logo_bg: true, is_verified: true } },
        category: { select: { id: true, name_es: true, name_en: true } },
        subcategory: { select: { id: true, name_es: true, name_en: true } },
        variants: {
          where: { is_active: true },
          select: {
            id: true, name_es: true, name_en: true, price: true,
            compare_at_price: true, b2b_price: true, stock_quantity: true, low_stock_threshold: true,
            is_default: true, sku: true,
          },
          orderBy: { is_default: 'desc' },
        },
        images: {
          select: { id: true, url: true, alt_text: true, is_primary: true },
          orderBy: { sort_order: 'asc' },
        },
      },
    }),
    prisma.product.count({ where }),
  ]);

  // Compat: keep old shop_id string alongside store_id/store during the
  // frontend rollout window (defends per feedback_deploy-shape-skew).
  const shimmed = products.map((p) => ({ ...p, shop_id: p.store?.slug ?? null }));

  return success(res, {
    products: shimmed,
    total,
    page: params.page,
    totalPages: Math.ceil(total / params.limit),
  });
}));

// ─── GET /api/stores/:slug/subcategories ────────────────
// Subcategories this store actually carries within one category. The
// storefront drill-down must not offer taxonomy the store has no products
// in — the global /api/categories/:id/subcategories lists every subcategory
// in the catalogue. Mirrors the category_counts rollup on GET /:slug.

router.get('/:slug/subcategories', asyncHandler(async (req, res) => {
  const store = await prisma.store.findUnique({
    where: { slug: req.params.slug },
    select: { id: true, is_active: true, deletion_scheduled_at: true, deleted_at: true },
  });
  if (!store || !isStoreCustomerVisible(store)) return error(res, 'Store not found.', 404);

  const categoryId = req.query.categoryId as string | undefined;
  if (!categoryId) return success(res, []);

  const groups = await prisma.product.groupBy({
    by: ['subcategory_id'],
    where: {
      store_id: store.id, is_active: true, ...(await shownToViewer(req)),
      category_id: categoryId, subcategory_id: { not: null },
    },
    _count: { _all: true },
  });
  if (groups.length === 0) return success(res, []);

  const subs = await prisma.subCategory.findMany({
    where: { id: { in: groups.map((g) => g.subcategory_id as string) }, is_active: true },
    select: { id: true, name_es: true, name_en: true, sort_order: true },
    orderBy: { sort_order: 'asc' },
  });
  return success(res, subs.map((s) => ({
    id: s.id,
    name_es: s.name_es,
    name_en: s.name_en,
    sort_order: s.sort_order,
    count: groups.find((g) => g.subcategory_id === s.id)?._count._all ?? 0,
  })));
}));

// ─── GET /api/stores/:slug/product-types ────────────────
// Third-tier taxonomy, scoped to this store. Same reasoning as
// /:slug/subcategories — only the product types the store has products in.

router.get('/:slug/product-types', asyncHandler(async (req, res) => {
  const store = await prisma.store.findUnique({
    where: { slug: req.params.slug },
    select: { id: true, is_active: true, deletion_scheduled_at: true, deleted_at: true },
  });
  if (!store || !isStoreCustomerVisible(store)) return error(res, 'Store not found.', 404);

  const subcategoryId = req.query.subcategoryId as string | undefined;
  if (!subcategoryId) return success(res, []);

  const groups = await prisma.product.groupBy({
    by: ['product_type_id'],
    where: {
      store_id: store.id, is_active: true, ...(await shownToViewer(req)),
      subcategory_id: subcategoryId, product_type_id: { not: null },
    },
    _count: { _all: true },
  });
  if (groups.length === 0) return success(res, []);

  const types = await prisma.productType.findMany({
    where: { id: { in: groups.map((g) => g.product_type_id as string) }, is_active: true },
    select: { id: true, subcategory_id: true, name_es: true, name_en: true, sort_order: true },
    orderBy: [{ sort_order: 'asc' }, { name_es: 'asc' }],
  });
  return success(res, types.map((t) => ({
    id: t.id,
    subcategory_id: t.subcategory_id,
    name_es: t.name_es,
    name_en: t.name_en,
    sort_order: t.sort_order,
    count: groups.find((g) => g.product_type_id === t.id)?._count._all ?? 0,
  })));
}));

// ─── POST /api/stores/:slug/follow ──────────────────────
// Requires customer auth. Idempotent — following an already-followed store
// returns the current count without touching it. Wraps insert + count bump
// in one transaction so followers_count can't drift.

router.post('/:slug/follow', requireAuth, asyncHandler(async (req, res) => {
  const store = await prisma.store.findUnique({
    where: { slug: req.params.slug },
    select: { id: true, is_active: true, followers_count: true, deletion_scheduled_at: true, deleted_at: true },
  });
  if (!store || !isStoreCustomerVisible(store)) return error(res, 'Store not found.', 404);

  const userId = req.user!.userId;
  const existing = await prisma.storeFollow.findUnique({
    where: { user_id_store_id: { user_id: userId, store_id: store.id } },
    select: { user_id: true },
  });
  if (existing) {
    return success(res, { followers_count: store.followers_count, is_followed: true });
  }
  const [, updated] = await prisma.$transaction([
    prisma.storeFollow.create({ data: { user_id: userId, store_id: store.id } }),
    prisma.store.update({
      where: { id: store.id },
      data: { followers_count: { increment: 1 } },
      select: { followers_count: true },
    }),
  ]);
  return success(res, { followers_count: updated.followers_count, is_followed: true });
}));

router.delete('/:slug/follow', requireAuth, asyncHandler(async (req, res) => {
  const store = await prisma.store.findUnique({
    where: { slug: req.params.slug },
    select: { id: true, is_active: true, followers_count: true, deletion_scheduled_at: true, deleted_at: true },
  });
  if (!store || !isStoreCustomerVisible(store)) return error(res, 'Store not found.', 404);

  const userId = req.user!.userId;
  const existing = await prisma.storeFollow.findUnique({
    where: { user_id_store_id: { user_id: userId, store_id: store.id } },
    select: { user_id: true },
  });
  if (!existing) {
    return success(res, { followers_count: store.followers_count, is_followed: false });
  }
  const [, updated] = await prisma.$transaction([
    prisma.storeFollow.delete({
      where: { user_id_store_id: { user_id: userId, store_id: store.id } },
    }),
    prisma.store.update({
      where: { id: store.id },
      // Guard against a bad state where followers_count somehow drifted below
      // real follows — Postgres would clamp with a check, we do it explicitly.
      data: { followers_count: { decrement: 1 } },
      select: { followers_count: true },
    }),
  ]);
  return success(res, {
    followers_count: Math.max(0, updated.followers_count),
    is_followed: false,
  });
}));

export default router;
