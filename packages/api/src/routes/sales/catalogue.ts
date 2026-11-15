import { Router, type Request } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { success, error } from '../../lib/response';
import { asyncHandler } from '../../lib/async';
import { parsePage, paged } from '../../lib/pagination';
import { productFilterSchema, buildProductWhere } from '../../lib/product-filters';
import {
  effectiveUnitPrice, pricingForAccount, RETAIL_CONTEXT, VAT_FIELDS, vatRateOf, withVat, type PricingContext,
} from '../../lib/pricing';
import { audienceOf, audiencesFor } from '../../lib/audience';
import { assignedScope, repProductScope, sellableShopIds } from '../../lib/repStore';
import { reachOf } from '../../lib/repClients';

/**
 * The catalogue, as the rep order screen needs it.
 *
 * That screen is a port of the admin one, filter rail and all, so this serves
 * the SAME SHAPES its panel already reads — `Paged<Product>` with nested
 * variants, plus the five taxonomy lists behind the dropdowns, each matching
 * what its admin counterpart returns (arrays for brands and origins, paged for
 * stores, a plain array for categories). Reusing `productFilterSchema` and
 * `buildProductWhere` rather than writing a second filter implementation is the
 * point: a filter that behaved differently here would be a screen that looks
 * identical and answers differently.
 *
 * THREE THINGS THIS DOES THAT THE ADMIN ROUTE DOES NOT — the third, since
 * 2026-10-25: THE REP'S SHOPS ONLY, the ones an admin assigned them
 * (lib/repStore), and nothing at all without one. The filter lists below
 * follow them.
 *
 * And the first two:
 *
 *   1. ACTIVE ONLY, forced after the filters are built so no query string can
 *      turn it off. A rep cannot sell an inactive product — lib/createOrder
 *      refuses it — so offering one produces a refusal at the end of a built
 *      basket. Admin legitimately browses inactive rows; a rep has no reason
 *      to see the 10,698 of them on production.
 *
 *   2. PRICED FOR THE CLIENT. `variant.price` comes back as what THIS client
 *      will actually be charged, and `b2b_price` is dropped. The admin screen
 *      shows retail and lets the server reprice on create, which is fine when
 *      you are not standing in front of the buyer; a rep reading a total that
 *      changes when they press Create is not.
 *
 *      `compare_at_price` is cleared alongside a wholesale price, because the
 *      panel renders it as a strike-through "was" and a retail compare-at
 *      above a wholesale price would invent a discount nobody is offering.
 *
 *      BROWSING IS THE EXCEPTION (since 2026-10-26, the rep's Catálogo tab):
 *      with no client and `prices=both`, a size keeps its retail `price` and
 *      also carries `b2b_price` — the rep is not quoting anybody, they are
 *      reading what a shop and a household would each pay. Nothing secret
 *      leaks: picking a business client in the builder already shows them the
 *      wholesale figure. With a client, `prices` is ignored and the rule above
 *      holds.
 *
 * The taxonomy is the same data the public storefront already serves to
 * anonymous visitors. It is repeated under this prefix so the ported panel can
 * reach it with the rep's token, and it is READ-ONLY: a rep picks from the
 * categories, brands and origins an admin curates.
 */

const router = Router();

/**
 * Resolve the pricing context from the client the basket is for.
 *
 * The client must be in the rep's reach (lib/repClients) — the same scope every
 * other read here enforces, and for the same reason. An absent `for_client` prices at retail
 * rather than failing: browsing before picking anybody is an ordinary thing to
 * do. Null means "asked for a client they cannot see".
 */
async function contextFor(repId: string, forClient: string): Promise<PricingContext | null> {
  if (!forClient) return RETAIL_CONTEXT;
  const client = await prisma.user.findFirst({
    where: { AND: [{ id: forClient }, reachOf(repId)] },
    select: { is_business: true },
  });
  if (!client) return null;
  // The same rule the order is written with (lib/createOrder), so the price
  // on the card is the price on the order.
  return pricingForAccount(client);
}

// ─── GET /api/sales/catalogue/products ──────────────────
const listQuerySchema = productFilterSchema.extend({
  sort: z.enum(['newest', 'oldest', 'name_asc', 'name_desc', 'rating_desc']).optional(),
  /** Accepted and ignored — the ported panel sends it; these rows are always
   *  the full shape, because that is the only shape the panel reads. */
  full: z.string().optional(),
  for_client: z.string().uuid().optional(),
  /** The Catálogo tab: retail AND wholesale on every size — see above. */
  prices: z.enum(['both']).optional(),
  /**
   * One product — the size a rep picked in the Catálogo, read again once the
   * order screen knows the client, so it goes into the basket at THEIR price.
   * Every rule below still applies: outside the rep's shops, inactive, or
   * not shown to this client, and the answer is an empty page.
   */
  productId: z.string().uuid().optional(),
  /**
   * Only the products assigned to this rep by hand (lib/repStore) — the
   * "Asignados" chip beside their shops. Within every rule above, like a
   * storeId filter: it narrows, never widens.
   */
  assigned: z.enum(['true']).optional(),
});

router.get('/products', asyncHandler(async (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return error(res, parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '), 422);
  }
  const { sort, full: _ignored, for_client: forClient, prices, productId, assigned, ...filters } = parsed.data;
  const bothPrices = prices === 'both' && !forClient;
  const repId = req.salesRep!.user.id;
  const scope = req.salesRep!.rep.store;
  const byHand = scope.products > 0;
  const params = parsePage(req.query, 20, 100);

  const ctx = await contextFor(repId, forClient ?? '');
  if (!ctx) return error(res, 'Client not found.', 404);

  const where = buildProductWhere(filters);
  if (productId) where.id = productId;
  // After the filters, never before: this is not a default the caller may
  // override.
  where.is_active = true;
  // For a client, what that client is shown — B2C only, B2B only or both
  // (lib/audience) — as the price on the card is theirs. Browsing with nobody
  // picked shows everything.
  if (forClient) where.audience = { in: audiencesFor(audienceOf(ctx)) };
  // Only the rep's shops (lib/repStore) — nothing at all without one.
  // ANDed, so a storeId filter naming another shop finds nothing rather than
  // widening it, and one naming one of theirs narrows to it.
  where.AND = [
    ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
    repProductScope(scope),
    // The "Asignados" chip: the products assigned by hand, whichever shop.
    ...(assigned ? [byHand ? assignedScope(repId) : { id: { in: [] } }] : []),
  ];

  let orderBy: Prisma.ProductOrderByWithRelationInput | Prisma.ProductOrderByWithRelationInput[];
  switch (sort) {
    case 'oldest':      orderBy = { created_at: 'asc' };                          break;
    case 'name_asc':    orderBy = [{ name_es: 'asc' },  { name_en: 'asc' }];      break;
    case 'name_desc':   orderBy = [{ name_es: 'desc' }, { name_en: 'desc' }];     break;
    case 'rating_desc': orderBy = [{ rating: 'desc' }, { rating_count: 'desc' }]; break;
    case 'newest':
    default:            orderBy = { created_at: 'desc' };                         break;
  }

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      // Mirrors the admin route's `full` select, because the panel IS the
      // admin panel and reads the same fields.
      select: {
        id: true, name_es: true, name_en: true, brand: true, brand_id: true,
        origin: true, origin_id: true, store_id: true,
        is_active: true, is_featured: true, is_sponsored: true, is_new_arrival: true,
        created_at: true, is_verified: true, is_top_seller: true,
        is_quotation_enabled: true, rating: true, rating_count: true,
        // Its IVA: the band the cards show, and what every price below carries.
        ...VAT_FIELDS,
        // Who it is shown to (lib/audience). Browsing with nobody picked
        // lists every audience, so the card says when one is narrower.
        audience: true,
        description_es: true, description_en: true,
        category_id: true, subcategory_id: true, product_type_id: true,
        updated_at: true,
        category: { select: { id: true, name_es: true } },
        store: { select: { id: true, slug: true, name: true } },
        brand_ref: { select: { id: true, name: true, slug: true, logo_url: true, logo_bg: true } },
        origin_ref: { select: { id: true, key: true, label_es: true, label_en: true } },
        variants: {
          where: { is_active: true },
          orderBy: [{ is_default: 'desc' }, { created_at: 'asc' }] as const,
          select: {
            id: true, price: true, compare_at_price: true, b2b_price: true,
            stock_quantity: true, low_stock_threshold: true, is_default: true,
            name_es: true, name_en: true, sku: true,
          },
        },
        images: { where: { is_primary: true }, select: { url: true }, take: 1 },
        // Whether it is this rep's by hand — at most one row, theirs.
        rep_assignments: { where: { sales_rep_id: repId }, select: { product_id: true }, take: 1 },
      },
      orderBy,
      skip: params.skip,
      take: params.limit,
    }),
    prisma.product.count({ where }),
  ]);

  const priced = products.map(({ rep_assignments: mine, ...p }) => {
    // Every price here is what a customer pays, so with the product's IVA
    // (2026-11-01: stored prices are bases) — the same rule checkout uses.
    const rate = vatRateOf(p);
    const gross = (value: Prisma.Decimal | null) => (value == null ? null : withVat(value, rate));
    return {
      ...p,
      /** Assigned to this rep by hand, rather than (only) through one of their shops. */
      assigned: mine.length > 0,
      variants: p.variants.map((v) => {
        if (bothPrices) {
          return { ...v, price: withVat(v.price, rate), b2b_price: gross(v.b2b_price), compare_at_price: gross(v.compare_at_price) };
        }
        const unit = effectiveUnitPrice(v, ctx, p);
        const wholesale = !unit.equals(withVat(v.price, rate));
        const { b2b_price: _dropped, ...rest } = v;
        return {
          ...rest,
          price: unit,
          compare_at_price: wholesale ? null : gross(v.compare_at_price),
        };
      }),
    };
  });

  return success(res, paged(priced, total, params));
}));

// ─── The taxonomy behind the filter rail ────────────────

/** Filter rows that lead somewhere: with an active product in the rep's shops. */
const inRepShop = (req: Request) => ({ products: { some: { is_active: true, ...repProductScope(req.salesRep!.rep.store) } } });

/**
 * How many of the rep's products sit under each brand, origin or shop — the
 * number on the Catálogo's browse cards (2026-10-28, user: "If they select
 * store then the store cards will show… Similarly for origin and brands").
 * The same products the list behind a card shows: active, in the rep's shops.
 */
async function repCounts(req: Request, by: 'brand_id' | 'origin_id' | 'store_id'): Promise<Map<string | null, number>> {
  const rows = await prisma.product.groupBy({
    by: [by],
    where: { is_active: true, ...repProductScope(req.salesRep!.rep.store) },
    _count: { _all: true },
  });
  return new Map(rows.map((g) => [g[by], g._count._all]));
}

router.get('/categories', asyncHandler(async (req, res) => {
  const categories = await prisma.category.findMany({
    // `approved` as well as active: a partner-submitted category awaiting
    // review is not something to sell out of yet.
    where: { is_active: true, approval_status: 'approved' },
    select: {
      id: true, name_es: true, name_en: true, icon_url: true,
      bg_color: true, accent_color: true, sort_order: true, is_active: true,
      _count: { select: { subcategories: true, products: true } },
    },
    orderBy: { sort_order: 'asc' },
  });
  // What the rep's shops have in each (lib/repStore). Every category is still
  // listed — quick-add files a new product under any of them — and the order
  // screen's strip shows only those with some, so no chip opens onto nothing.
  const inShop = await prisma.product.groupBy({
    by: ['category_id'],
    where: { is_active: true, ...repProductScope(req.salesRep!.rep.store) },
    _count: { _all: true },
  });
  const shopCount = new Map(inShop.map((g) => [g.category_id, g._count._all]));
  return success(res, categories.map((c) => ({ ...c, shop_products: shopCount.get(c.id) ?? 0 })));
}));

router.get('/subcategories', asyncHandler(async (req, res) => {
  const subcategories = await prisma.subCategory.findMany({
    where: { is_active: true, ...inRepShop(req) },
    select: {
      id: true, category_id: true, name_es: true, name_en: true,
      sort_order: true, is_active: true,
      category: { select: { id: true, name_es: true } },
    },
    orderBy: { sort_order: 'asc' },
  });
  return success(res, subcategories);
}));

router.get('/brands', asyncHandler(async (req, res) => {
  const [brands, counts] = await Promise.all([
    prisma.brand.findMany({
      where: { is_active: true, ...inRepShop(req) },
      select: {
        id: true, name: true, slug: true, logo_url: true, logo_bg: true,
        link: true, is_active: true, sort_order: true,
      },
      orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
    }),
    repCounts(req, 'brand_id'),
  ]);
  return success(res, brands.map((b) => ({ ...b, products: counts.get(b.id) ?? 0 })));
}));

router.get('/origins', asyncHandler(async (req, res) => {
  const [origins, counts] = await Promise.all([
    prisma.origin.findMany({
      where: { is_active: true, ...inRepShop(req) },
      select: {
        id: true, key: true, label_es: true, label_en: true,
        bg_color: true, accent_color: true, image_url: true, link: true,
        is_active: true, sort_order: true,
      },
      orderBy: [{ sort_order: 'asc' }, { label_es: 'asc' }],
    }),
    repCounts(req, 'origin_id'),
  ]);
  return success(res, origins.map((o) => ({ ...o, products: counts.get(o.id) ?? 0 })));
}));

router.get('/stores', asyncHandler(async (req, res) => {
  const params = parsePage(req.query, 200, 500);
  // Only the rep's own shops that can be sold from (lib/repStore). Cesto's
  // own catalogue has no Store row, so it is not in this list.
  const shopWhere: Prisma.StoreWhereInput = { id: { in: sellableShopIds(req.salesRep!.rep.store) } };
  const [stores, total, counts] = await Promise.all([
    prisma.store.findMany({
      where: shopWhere,
      select: {
        id: true, slug: true, name: true, logo_url: true, logo_bg: true,
        status: true, is_verified: true,
        // What the Catálogo's shop card shows: its banner, its line, today's hours.
        cover_url: true, tagline_es: true, tagline_en: true, shop_hours: true,
        _count: { select: { products: true } },
      },
      orderBy: { name: 'asc' },
      skip: params.skip,
      take: params.limit,
    }),
    prisma.store.count({ where: shopWhere }),
    repCounts(req, 'store_id'),
  ]);
  // `_count` is every product the shop has, any state; `products` is what the
  // rep finds behind its card — active ones.
  return success(res, paged(stores.map((s) => ({ ...s, products: counts.get(s.id) ?? 0 })), total, params));
}));

export default router;
