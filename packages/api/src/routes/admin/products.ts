import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { success, error } from '../../lib/response';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/async';
import { parsePage, paged } from '../../lib/pagination';
import { invalidateCountCache } from '../../lib/count-cache';
import { productFilterSchema, buildProductWhere } from '../../lib/product-filters';
import { resolveProductRefs } from '../../lib/product-refs';
import { B2bPriceRequired, assertB2bPriced, b2bPriceRequiredBody } from '../../lib/audience';
import { moveRepAssignments } from '../../lib/repStore';
import productsExportRouter from './productsExport';
import productsImportDuplicatesRouter from './productsImportDuplicates';
import productsBulkRouter, { BULK_EDIT_MAX_PRODUCTS } from './productsBulk';

const router = Router();

const variantSchema = z.object({
  id: z.string().uuid().optional(),
  name_es: z.string().min(1),
  name_en: z.string().min(1),
  price: z.number().positive(),
  compare_at_price: z.number().positive().nullable().optional(),
  b2b_price: z.number().positive().nullable().optional(),
  /** What Cesto pays for one. Absent = left as it is (0 on a new size). */
  cost_price: z.number().min(0).max(100000).optional(),
  stock_quantity: z.number().int().min(0).default(0),
  low_stock_threshold: z.number().int().min(0).default(10),
  is_default: z.boolean().default(false),
  is_active: z.boolean().default(true),
  sku: z.string().nullable().optional(),
});

// Accept either an absolute URL (http(s)://, data:, blob:) or a server-relative
// path (e.g. "/uploads/products/abc.jpg"). The latter is what our local upload
// endpoint returns; storing it relative keeps the DB host-agnostic.
const imageUrlSchema = z
  .string()
  .min(1)
  .refine(
    (s) => /^(https?:\/\/|\/|data:|blob:)/.test(s),
    { message: 'Must be a URL or a server path starting with /' },
  );

const imageSchema = z.object({
  id: z.string().uuid().optional(),
  url: imageUrlSchema,
  alt_text: z.string().nullable().optional(),
  sort_order: z.number().int().default(0),
  is_primary: z.boolean().default(false),
});

const productSchema = z.object({
  name_es: z.string().min(1),
  name_en: z.string().min(1),
  description_es: z.string().nullable().optional(),
  description_en: z.string().nullable().optional(),
  brand: z.string().nullable().optional(),
  origin: z.string().nullable().optional(),
  store_id: z.string().uuid().nullable().optional(),
  category_id: z.string().uuid(),
  subcategory_id: z.string().uuid().nullable().optional(),
  product_type_id: z.string().uuid().nullable().optional(),
  /**
   * Spanish IVA band.
   *
   * Optional because the importer and the storefront-facing clients do not
   * send one, and a product without it keeps the schema's `reduced` default.
   * But when a HUMAN sends one it counts as reviewed, and that is the only
   * way a product ever becomes invoiceable: computeBlockers() refuses a
   * factura while any line's product still has vat_category_reviewed false.
   * Until this field existed, nothing outside quick-create could clear it,
   * so every order could only ever be an albaran.
   */
  vat_category: z.enum(['zero', 'super_reduced', 'reduced', 'general']).optional(),
  is_active: z.boolean().default(true),
  is_featured: z.boolean().default(false),
  is_verified: z.boolean().default(false),
  is_top_seller: z.boolean().default(false),
  is_sponsored: z.boolean().default(false),
  // Opt-in to the home "New products" rail. Defaults false, so creating or
  // importing a product never puts it on the shop front by itself.
  is_new_arrival: z.boolean().default(false),
  // Shows a "Request quotation" button on the product detail page.
  is_quotation_enabled: z.boolean().default(false),
  /**
   * Who is shown it in the shop and the app (lib/audience): both kinds of
   * customer (the default), B2C only, or B2B only. Optional with no default,
   * so a save from a form that predates it leaves the setting alone.
   */
  audience: z.enum(['all', 'b2c', 'b2b']).optional(),
  rating: z.number().min(0).max(5).nullable().optional(),
  rating_count: z.number().int().min(0).default(0),
  variants: z.array(variantSchema).min(1),
  images: z.array(imageSchema).default([]),
});

// ─── GET /api/admin/products ────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const listQuerySchema = productFilterSchema.extend({
  // Price sort is intentionally omitted — Prisma can't cleanly order by a
  // nested scalar on a related list (variants.price) at the top-level query
  // shape we use here. Add it later with a raw SQL join if the need arises.
  sort: z.enum([
    'newest', 'oldest',
    'name_asc', 'name_desc',
    'rating_desc',
  ]).optional(),
  // Bulk-edit grid support. `full` widens the select with the fields the
  // grid edits but the table never showed; `ids` restricts to an explicit
  // set (the "N selected" case, as opposed to select-all-matching).
  full: z.enum(['1', 'true']).optional(),
  ids: z.string().max(10_000).optional(),
}).passthrough();

router.get('/', asyncHandler(async (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return error(res, parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '), 422);
  }
  const { sort, full, ids, ...filters } = parsed.data;
  const isFull = full === '1' || full === 'true';

  // `full` rows are much heavier, so the bulk-edit cap doubles as the page
  // cap here — parsePage otherwise clamps at 100 and the grid would silently
  // load only the first 100 of a 250-product selection.
  const params = parsePage(req.query, 20, isFull ? BULK_EDIT_MAX_PRODUCTS : 100);

  const where = buildProductWhere(filters);

  if (ids !== undefined) {
    const idList = ids.split(',').map((s) => s.trim()).filter(Boolean);
    if (idList.length > BULK_EDIT_MAX_PRODUCTS) {
      return error(res, `Too many ids (max ${BULK_EDIT_MAX_PRODUCTS}).`, 422);
    }
    if (idList.some((id) => !UUID_RE.test(id))) {
      return error(res, 'ids must be a comma-separated list of UUIDs.', 422);
    }
    where.id = { in: idList };
  }

  // Sort. Default `newest` mirrors the pre-filter behaviour.
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
      select: {
        id: true, name_es: true, name_en: true, brand: true, brand_id: true, origin: true, origin_id: true, store_id: true,
        is_active: true, is_featured: true, is_sponsored: true, is_new_arrival: true, created_at: true,
        is_verified: true, is_top_seller: true, is_quotation_enabled: true, rating: true, rating_count: true,
        // Who is shown it: both, B2C only, B2B only (lib/audience).
        audience: true,
        // The IVA bucket and whether anybody chose it: the order builder adds
        // it to these base prices (0 % until chosen) and splits it back out
        // in its breakdown, with no second request per product.
        vat_category: true, vat_category_reviewed: true,
        category: { select: { id: true, name_es: true } },
        store: { select: { id: true, slug: true, name: true } },
        brand_ref:  { select: { id: true, name: true, slug: true, logo_url: true, logo_bg: true } },
        origin_ref: { select: { id: true, key: true, label_es: true, label_en: true } },
        // Fields the table never showed but the bulk-edit grid can edit.
        ...(isFull ? {
          description_es: true, description_en: true,
          // category_id as well as the nested `category` — the grid's select
          // cell needs the raw FK, not the joined display row.
          category_id: true, subcategory_id: true, product_type_id: true,
          updated_at: true,
        } : {}),
        // Same filter as GET /:id — a deleted variant was still contributing
        // its price and stock to the list row, so the catalogue table showed
        // numbers for a variant no shopper can buy.
        variants: {
          where: { is_active: true },
          // Deterministic order — without it the grid's variant sub-rows
          // reshuffle between refetches.
          orderBy: [{ is_default: 'desc' }, { created_at: 'asc' }] as const,
          select: {
            id: true, price: true, compare_at_price: true, b2b_price: true,
            // The buying price — admin only; every other read omits it (lib/prisma).
            cost_price: true,
            stock_quantity: true, low_stock_threshold: true, is_default: true,
            ...(isFull ? { name_es: true, name_en: true, sku: true } : {}),
          },
        },
        images: { where: { is_primary: true }, select: { url: true }, take: 1 },
      },
      orderBy,
      skip: params.skip,
      take: params.limit,
    }),
    prisma.product.count({ where }),
  ]);

  return success(res, paged(products, total, params));
}));

// ─── GET /api/admin/products/brands ────────────────────
// Distinct list of brand names found on existing products, sorted by usage.
// Used by the Top Brands editor so admins pick from real catalogue brands.

router.get('/brands', asyncHandler(async (_req, res) => {
  const rows = await prisma.product.groupBy({
    by: ['brand'],
    where: { brand: { not: null } },
    _count: { _all: true },
  });
  // Merge case-variant groups (`SHAN`, `Shan`, `shan` → one entry). We pick
  // the display name from the group with the highest product_count so the
  // canonical casing survives if the DB still carries legacy mixed-case rows.
  const merged = new Map<string, { name: string; product_count: number; peakCount: number }>();
  for (const r of rows) {
    const raw = (r.brand ?? '').trim();
    if (!raw) continue;
    const key = raw.toLowerCase();
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { name: raw, product_count: r._count._all, peakCount: r._count._all });
    } else {
      existing.product_count += r._count._all;
      if (r._count._all > existing.peakCount) {
        existing.name = raw;
        existing.peakCount = r._count._all;
      }
    }
  }
  const brands = Array.from(merged.values())
    .map(({ name, product_count }) => ({ name, product_count }))
    .sort((a, b) => b.product_count - a.product_count || a.name.localeCompare(b.name));
  return success(res, brands);
}));

// ─── GET /api/admin/products/origins ───────────────────
// Same shape as /brands but pulls distinct origins. Powers the Shop by Origin
// admin picker so admins curate from real catalogue origins.

router.get('/origins', asyncHandler(async (_req, res) => {
  const rows = await prisma.product.groupBy({
    by: ['origin'],
    where: { origin: { not: null } },
    _count: { _all: true },
  });
  // Merge case-variants server-side so `India`/`INDIA`/`india` surface as
  // one entry. Display key = the casing on the group with the highest
  // product_count, so legacy mixed-case rows still coalesce sensibly.
  const merged = new Map<string, { key: string; product_count: number; peakCount: number }>();
  for (const r of rows) {
    const raw = (r.origin ?? '').trim();
    if (!raw) continue;
    const k = raw.toLowerCase();
    const existing = merged.get(k);
    if (!existing) {
      merged.set(k, { key: raw, product_count: r._count._all, peakCount: r._count._all });
    } else {
      existing.product_count += r._count._all;
      if (r._count._all > existing.peakCount) {
        existing.key = raw;
        existing.peakCount = r._count._all;
      }
    }
  }
  const origins = Array.from(merged.values())
    .map(({ key, product_count }) => ({ key, product_count }))
    .sort((a, b) => b.product_count - a.product_count || a.key.localeCompare(b.key));
  return success(res, origins);
}));

// ─── /duplicates sub-router ─────────────────────────────
// Mounted HERE (before `/:id`) so /duplicates + /duplicates/resolve get
// dispatched to their handlers instead of being caught by GET /:id — an
// earlier version had them registered later in the file and Express
// happily routed GET /duplicates to `findUnique({ id: 'duplicates' })`,
// which blew up trying to parse "duplicates" as a UUID.
//
// The sub-router is empty at mount time; the actual handlers get
// attached below (search for `duplicatesRouter.get`). Sub-routers
// dispatch at request time, so declaration order within the sub-router
// doesn't matter here.
const duplicatesRouter = Router();
router.use('/duplicates', duplicatesRouter);

// Same rationale as /duplicates above: mount before router.get('/:id') so
// GET /export doesn't get caught by findUnique({ id: 'export' }).
router.use('/export', productsExportRouter);
// Same guard again — /import-duplicates has its own sub-router with GET /
// (list pending), POST /:id/create, POST /:id/dismiss.
router.use('/import-duplicates', productsImportDuplicatesRouter);
// Same guard again — /bulk (partial patch) and /bulk/action (quick actions).
router.use('/bulk', productsBulkRouter);

// ─── GET /api/admin/products/:id ────────────────────────
// NOTE: any new specific route (e.g. `/foo`) MUST go ABOVE this line.
// `/:id` matches every single-segment path, so a later `router.get('/foo')`
// would be dead — Express matches in declaration order.

router.get('/:id', asyncHandler(async (req, res) => {
  const product = await prisma.product.findUnique({
    where: { id: req.params.id },
    include: {
      // Deleting a variant in the form soft-disables it (see PUT below —
      // the row is kept so OrderItem history still resolves). Returning
      // those here put the deleted row straight back into the edit form on
      // the next open, which read as the delete having silently failed.
      // The form has no concept of a disabled variant and no way to restore
      // one, so an inactive variant is only ever a deleted variant to it.
      variants: { where: { is_active: true }, omit: { cost_price: false } },
      images: { orderBy: { sort_order: 'asc' } },
    },
  });
  if (!product) return error(res, 'Product not found.', 404);
  return success(res, product);
}));

// ─── POST /api/admin/products ───────────────────────────

router.post('/', validate(productSchema), asyncHandler(async (req, res) => {
  const { variants, images, ...rest } = req.body;
  // B2B only needs a B2B price on every size (lib/audience).
  if (rest.audience === 'b2b') {
    const unpriced = (variants as z.infer<typeof variantSchema>[])
      .filter((v) => v.is_active !== false && !(Number(v.b2b_price ?? 0) > 0))
      .map((v) => ({ id: null, name_es: v.name_es, name_en: v.name_en, price: v.price }));
    if (unpriced.length > 0) {
      const err = new B2bPriceRequired(unpriced);
      return error(res, err.message, 422, b2bPriceRequiredBody(err));
    }
  }
  const refs = await resolveProductRefs(rest.brand ?? null, rest.origin ?? null);

  const product = await prisma.product.create({
    data: {
      ...rest,
      brand_id:  refs.brand_id,
      origin_id: refs.origin_id,
      // Someone picked the band, so it is reviewed. Omitting it leaves the
      // schema default untouched AND unreviewed, which is the honest state.
      ...(rest.vat_category !== undefined ? { vat_category_reviewed: true } : {}),
      variants: { create: variants.map(({ id: _i, ...v }: any) => v) },
      images: { create: images.map(({ id: _i, ...img }: any) => img) },
    },
    include: { variants: { omit: { cost_price: false } }, images: true },
  });

  invalidateCountCache();
  return success(res, product, 201);
}));

// ─── POST /api/admin/products/quick ─────────────────────
//
// A rep is holding a product that is not in the catalogue and has about
// twenty seconds. This is deliberately NOT the full product form: that page
// is 1475 lines with four tabs, takes no props, and navigates away on save,
// so it cannot be shown in a modal — and a rep does not want it anyway.
//
// The row it creates is real and immediately sellable, but flagged
// review_needed so a catalogue admin fills in the rest later.

const quickProductSchema = z.object({
  name_es: z.string().trim().min(1).max(200),
  name_en: z.string().trim().min(1).max(200),
  category_id: z.string().uuid(),
  brand: z.string().trim().max(120).optional(),
  /** Inherited from the order being built. null = the Cesto house store. */
  store_id: z.string().uuid().nullable().optional(),
  /**
   * Required, with no default, on purpose.
   *
   * Every other path leaves this on the `reduced` (10%) default with
   * vat_category_reviewed false, which is the data problem the invoicing
   * phases have to clean up. This is the one moment the answer is cheap — a
   * human is holding the product — so it is asked, and the answer is trusted.
   */
  vat_category: z.enum(['zero', 'super_reduced', 'reduced', 'general']),
  price: z.number().positive().max(100000),
  b2b_price: z.number().positive().max(100000).nullable().optional(),
  stock_quantity: z.number().int().min(0).max(100000).default(0),
  sku: z.string().trim().max(60).optional(),
  image_url: z.string().trim().min(1).optional(),
});

router.post('/quick', validate(quickProductSchema), asyncHandler(async (req, res) => {
  const body = req.body as z.infer<typeof quickProductSchema>;
  const adminId = req.admin?.adminId ?? null;

  const category = await prisma.category.findUnique({
    where: { id: body.category_id },
    select: { id: true },
  });
  if (!category) return error(res, 'That category no longer exists.', 422);

  const refs = await resolveProductRefs(body.brand ?? null, null);

  const product = await prisma.product.create({
    data: {
      name_es: body.name_es,
      name_en: body.name_en,
      category_id: body.category_id,
      brand: body.brand ?? null,
      brand_id: refs.brand_id,
      store_id: body.store_id ?? null,
      vat_category: body.vat_category,
      // A human just answered the question, so this is genuinely reviewed —
      // unlike the schema default, which nobody has ever confirmed.
      vat_category_reviewed: true,
      is_active: true,
      // Every promo flag stays false. A product described in twenty seconds
      // must not land on a storefront rail.
      is_featured: false,
      is_new_arrival: false,
      is_top_seller: false,
      is_sponsored: false,
      is_quotation_enabled: false,
      created_source: 'quick_create',
      created_by_admin_id: adminId,
      review_needed: true,
      variants: {
        create: [{
          name_es: 'Unidad',
          name_en: 'Unit',
          price: body.price,
          b2b_price: body.b2b_price ?? null,
          stock_quantity: body.stock_quantity,
          sku: body.sku ?? null,
          is_default: true,
          is_active: true,
        }],
      },
      ...(body.image_url
        ? { images: { create: [{ url: body.image_url, alt_text: body.name_es, sort_order: 0, is_primary: true }] } }
        : {}),
    },
    include: { variants: true, images: true, store: { select: { id: true, name: true } } },
  });

  invalidateCountCache();
  return success(res, product, 201);
}));

// ─── PUT /api/admin/products/:id/reviewed ───────────────
//
// Clears review_needed. Its own route rather than part of the general update,
// so that an admin editing a price does not silently mark the product as
// reviewed — the queue is only drained deliberately.
router.put('/:id/reviewed', asyncHandler(async (req, res) => {
  try {
    const product = await prisma.product.update({
      where: { id: req.params.id },
      data: { review_needed: false },
      select: { id: true, review_needed: true },
    });
    return success(res, product);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      return error(res, 'Product not found.', 404);
    }
    throw err;
  }
}));

// ─── PUT /api/admin/products/:id/audience ───────────────
//
// Who the shop shows it to — both kinds of customer, B2C only, B2B only —
// from the products table, without opening and saving the whole form.
// B2B only needs a B2B price on every size: the table asks for the missing
// ones and sends them here with it, so both land together or neither does.
const audienceSchema = z.object({
  audience: z.enum(['all', 'b2c', 'b2b']),
  b2b_prices: z.array(z.object({
    variant_id: z.string().uuid(),
    b2b_price: z.number().positive().max(100000),
  })).max(50).optional(),
});
/** A b2b_prices entry named a size of some other product. */
class SizeNotFound extends Error {}
router.put('/:id/audience', validate(audienceSchema), asyncHandler(async (req, res) => {
  const body = req.body as z.infer<typeof audienceSchema>;
  const productId = req.params.id;
  try {
    const product = await prisma.$transaction(async (tx) => {
      const updated = await tx.product.update({
        where: { id: productId },
        data: { audience: body.audience },
        select: { id: true, audience: true },
      });
      for (const p of body.b2b_prices ?? []) {
        // Scoped by product: the variant ids come from the client.
        const r = await tx.productVariant.updateMany({
          where: { id: p.variant_id, product_id: productId },
          data: { b2b_price: p.b2b_price },
        });
        if (r.count === 0) throw new SizeNotFound();
      }
      await assertB2bPriced(tx, productId);
      return updated;
    });
    // Category, brand and origin counts depend on who is shown what.
    invalidateCountCache();
    return success(res, product);
  } catch (err) {
    if (err instanceof B2bPriceRequired) return error(res, err.message, 422, b2bPriceRequiredBody(err));
    if (err instanceof SizeNotFound) return error(res, 'That size is not one of this product\'s.', 422);
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      return error(res, 'Product not found.', 404);
    }
    throw err;
  }
}));

// ─── PUT /api/admin/products/:id ────────────────────────

router.put('/:id', validate(productSchema), asyncHandler(async (req, res) => {
  const { variants, images, ...rest } = req.body;
  const productId = req.params.id;
  const refs = await resolveProductRefs(rest.brand ?? null, rest.origin ?? null);

  const updated = await prisma.$transaction(async (tx) => {
    await tx.product.update({
      where: { id: productId },
      data: {
        ...rest,
        brand_id: refs.brand_id,
        origin_id: refs.origin_id,
        ...(rest.vat_category !== undefined ? { vat_category_reviewed: true } : {}),
      },
    });

    // Variants: upsert, then deactivate ones not in payload
    const keepVariantIds: string[] = [];
    for (const v of variants) {
      const { id, ...data } = v;
      if (id) {
        await tx.productVariant.update({ where: { id }, data });
        keepVariantIds.push(id);
      } else {
        const created = await tx.productVariant.create({ data: { ...data, product_id: productId } });
        keepVariantIds.push(created.id);
      }
    }
    // Soft-disable removed variants (don't delete — preserves order history).
    // is_default is cleared at the same time: the payload sets the flag on a
    // surviving row, and leaving it on the removed one left the product with
    // two defaults in the table. Nothing customer-facing reads the dead row
    // (every catalogue query filters is_active), but admin tooling that
    // reaches for "the default variant" could pick the deleted one.
    await tx.productVariant.updateMany({
      where: { product_id: productId, id: { notIn: keepVariantIds } },
      data: { is_active: false, is_default: false },
    });

    // Images: replace wholesale (no order history dependency)
    await tx.productImage.deleteMany({ where: { product_id: productId } });
    if (images.length > 0) {
      await tx.productImage.createMany({
        data: images.map(({ id: _i, ...img }: any) => ({ ...img, product_id: productId })),
      });
    }

    // B2B only — chosen now or before — needs a B2B price on every size it
    // still sells (lib/audience), so clearing one is refused too.
    await assertB2bPriced(tx, productId);

    return tx.product.findUnique({
      where: { id: productId },
      include: { variants: { omit: { cost_price: false } }, images: { orderBy: { sort_order: 'asc' } } },
    });
  }).catch((err: unknown) => {
    if (err instanceof B2bPriceRequired) return err;
    throw err;
  });
  if (updated instanceof B2bPriceRequired) return error(res, updated.message, 422, b2bPriceRequiredBody(updated));

  // Who is shown it may have changed, and the shop's counts with it.
  if (rest.audience !== undefined) invalidateCountCache();
  return success(res, updated);
}));

// ─── DELETE /api/admin/products/:id ─────────────────────
// Default: soft delete (is_active=false). Pass ?permanent=true to fully remove
// the product + variants + images, but only if no order items reference any
// variant — that would either fail the FK or destroy order history.

router.delete('/:id', asyncHandler(async (req, res) => {
  const productId = req.params.id;
  const permanent = (req.query.permanent as string | undefined) === 'true';

  if (!permanent) {
    await prisma.product.update({ where: { id: productId }, data: { is_active: false } });
    return success(res, { message: 'Product deactivated.', permanent: false });
  }

  // Permanent delete path — verify safety first
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, variants: { select: { id: true } } },
  });
  if (!product) return error(res, 'Product not found.', 404);

  const variantIds = product.variants.map((v) => v.id);
  const orderItemCount = variantIds.length === 0
    ? 0
    : await prisma.orderItem.count({ where: { variant_id: { in: variantIds } } });

  if (orderItemCount > 0) {
    return error(
      res,
      `Cannot permanently delete: ${orderItemCount} order item(s) reference this product. Deactivate instead to preserve order history.`,
      409,
    );
  }

  // Safe to hard-delete. Cascade manually so the order matters and we don't
  // rely on schema-level cascades that may not be configured.
  await prisma.$transaction([
    prisma.productImage.deleteMany({ where: { product_id: productId } }),
    prisma.productVariant.deleteMany({ where: { product_id: productId } }),
    prisma.product.delete({ where: { id: productId } }),
  ]);

  invalidateCountCache();
  return success(res, { message: 'Product permanently deleted.', permanent: true });
}));

// ─── POST /api/admin/products/:id/purge ─────────────────
// Nuclear delete. Erases the product AND every order that ever contained
// it, AND cleans any Rashan pack / subscription JSON that referenced it.
// Rewrites customer order history — use only when the intent is total
// erasure (e.g. GDPR request, a legally-required takedown, a catalog
// mistake you want scrubbed).
//
// Order of operations inside one transaction:
//   1. Find every Order that has an OrderItem for this product.
//   2. Null SubscriptionDelivery.order_id pointing at those Orders — the
//      relation has no cascade, so leaving them would violate FK.
//   3. Delete those Orders — OrderItem cascades follow (schema: onDelete:
//      Cascade on order_items.order_id).
//   4. Strip product entries from rashan_packs.items JSON blobs.
//   5. Strip product entries from rashan_subscriptions.items JSON blobs.
//   6. Delete Product (ProductImage + ProductVariant cascade with it).
router.post('/:id/purge', asyncHandler(async (req, res) => {
  const productId = req.params.id;

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, name_en: true },
  });
  if (!product) return error(res, 'Product not found.', 404);

  const affectedOrderItems = await prisma.orderItem.findMany({
    where: { product_id: productId },
    select: { order_id: true },
    distinct: ['order_id'],
  });
  const affectedOrderIds = affectedOrderItems.map((r) => r.order_id);

  // Rashan JSON surgery: read → filter → write. Prisma can't push-remove
  // from a JSON array by predicate, so we do it in TS. Small tables in
  // practice; if this grows we'd switch to a $queryRaw jsonb_path_query.
  type RashanItem = { product_id?: string; variant_id?: string; quantity?: number; [k: string]: unknown };
  const packs = await prisma.rashanPack.findMany({ select: { id: true, items: true } });
  const packUpdates = packs
    .map((p) => {
      const items = Array.isArray(p.items) ? (p.items as unknown as RashanItem[]) : [];
      const filtered = items.filter((it) => it?.product_id !== productId);
      return filtered.length === items.length ? null : { id: p.id, items: filtered };
    })
    .filter((x): x is { id: string; items: RashanItem[] } => x !== null);

  const subs = await prisma.rashanSubscription.findMany({ select: { id: true, items: true } });
  const subUpdates = subs
    .map((s) => {
      const items = Array.isArray(s.items) ? (s.items as unknown as RashanItem[]) : [];
      const filtered = items.filter((it) => it?.product_id !== productId);
      return filtered.length === items.length ? null : { id: s.id, items: filtered };
    })
    .filter((x): x is { id: string; items: RashanItem[] } => x !== null);

  const [ordersDeleted] = await prisma.$transaction([
    // Null the SubscriptionDelivery link before Order goes so the FK
    // (no cascade set) doesn't block the delete.
    prisma.subscriptionDelivery.updateMany({
      where: { order_id: { in: affectedOrderIds } },
      data: { order_id: null },
    }),
    prisma.order.deleteMany({ where: { id: { in: affectedOrderIds } } }),
    ...packUpdates.map((p) =>
      prisma.rashanPack.update({
        where: { id: p.id },
        data: { items: p.items as unknown as Prisma.InputJsonValue },
      }),
    ),
    ...subUpdates.map((s) =>
      prisma.rashanSubscription.update({
        where: { id: s.id },
        data: { items: s.items as unknown as Prisma.InputJsonValue },
      }),
    ),
    prisma.productImage.deleteMany({ where: { product_id: productId } }),
    prisma.productVariant.deleteMany({ where: { product_id: productId } }),
    prisma.product.delete({ where: { id: productId } }),
  // Type gymnastics: subscriptionDelivery.updateMany + order.deleteMany
  // return distinct payload shapes so array destructuring gets the
  // first entry which we don't need — just pull counts from the raw
  // affectedOrderIds array below.
  ] as Prisma.PrismaPromise<unknown>[]);
  void ordersDeleted;
  invalidateCountCache();

  return success(res, {
    message: `Product "${product.name_en}" purged.`,
    orders_deleted: affectedOrderIds.length,
    rashan_packs_updated: packUpdates.length,
    rashan_subscriptions_updated: subUpdates.length,
  });
}));

// ─── GET /api/admin/products/duplicates ─────────────────
// Identity-based detection (2026-07-24). A "duplicate" is two products
// with the same product identity — normalised name_es + name_en + brand +
// origin + category + subcategory + product_type. Variants (size, price,
// stock, sku), descriptions, and images don't affect identity: an admin
// who imported "Arroz Tilda 1kg" and "Arroz Tilda 5kg" as separate
// products still has ONE product with two pack sizes, and this catches
// that.
//
// STORE handling:
//   - Same identity + SAME store → real duplicate, goes in `groups`.
//     Actionable (delete / merge).
//   - Same identity + DIFFERENT stores → legitimate multi-store listing,
//     goes in `multi_store_listings`. Informational only in the UI —
//     stocking the same product across N stores is intentional.
//   - Both can fire for the same fingerprint (partner-A has 2 copies AND
//     Cesto has 1) — we emit the partner-A pair as a duplicate group AND
//     the 3-way spread as a multi-store listing.
//
// Every product entry carries rashan_pack_names so the UI can warn when
// deletion would orphan a rashan pack reference.
duplicatesRouter.get('/', asyncHandler(async (_req, res) => {
  const rows = await prisma.product.findMany({
    select: {
      id: true,
      name_es: true,
      name_en: true,
      brand: true,
      origin: true,
      is_active: true,
      created_at: true,
      category_id: true,
      subcategory_id: true,
      product_type_id: true,
      store_id: true,
      store: { select: { id: true, slug: true, name: true } },
      _count: { select: { variants: true, images: true } },
      variants: {
        orderBy: [{ is_default: 'desc' }, { created_at: 'asc' }],
        select: {
          id: true, name_es: true, name_en: true, price: true,
          compare_at_price: true, b2b_price: true, stock_quantity: true,
          sku: true, is_default: true, is_active: true,
        },
      },
      images: {
        orderBy: [{ is_primary: 'desc' }, { sort_order: 'asc' }],
        take: 1,
        select: { url: true },
      },
    },
    orderBy: { created_at: 'asc' },
  });

  // Diacritic-insensitive normalize: NFKD then strip combining marks.
  // "Aceite" and "Acéite" collapse to the same key.
  const normalize = (s: string) =>
    s.trim()
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, ' ');

  // Identity fingerprint — the WHAT-IS-THIS-PRODUCT signature. Two rows
  // with the same fingerprint are the same product regardless of variant
  // pack sizes, prices, or store assignment. Descriptions + images are
  // deliberately excluded — real-world imports carry small text drift and
  // different image URLs for the same product; those benign differences
  // shouldn't hide real duplicates.
  const fingerprintOf = (p: typeof rows[number]): string => JSON.stringify([
    normalize(p.name_es),
    normalize(p.name_en),
    normalize(p.brand ?? ''),
    normalize(p.origin ?? ''),
    p.category_id ?? '',
    p.subcategory_id ?? '',
    p.product_type_id ?? '',
  ]);

  const byFingerprint = new Map<string, typeof rows>();
  for (const p of rows) {
    const fp = fingerprintOf(p);
    const bucket = byFingerprint.get(fp);
    if (bucket) bucket.push(p);
    else byFingerprint.set(fp, [p]);
  }

  // Partition each fingerprint bucket of ≥2 products into (same-store
  // duplicate groups) + (a multi-store listing if it spans ≥2 stores).
  const duplicateGroups: typeof rows[] = [];
  const multiStoreGroups: typeof rows[] = [];
  for (const bucket of byFingerprint.values()) {
    if (bucket.length < 2) continue;

    const distinctStores = new Set(bucket.map((p) => p.store_id ?? '__cesto__'));
    if (distinctStores.size >= 2) {
      multiStoreGroups.push(bucket);
    }

    const byStore = new Map<string, typeof rows>();
    for (const p of bucket) {
      const key = p.store_id ?? '__cesto__';
      const b = byStore.get(key);
      if (b) b.push(p);
      else byStore.set(key, [p]);
    }
    for (const storeBucket of byStore.values()) {
      if (storeBucket.length >= 2) duplicateGroups.push(storeBucket);
    }
  }

  // Diagnostic — grep Render logs for `[dedup:scan]` when a scan comes
  // back empty and you expected duplicates.
  const sample = rows.slice(0, 3).map((p) => ({
    name_es: p.name_es,
    brand: p.brand,
    fingerprint: fingerprintOf(p),
  }));
  // eslint-disable-next-line no-console
  console.log(
    `[dedup:scan] totalProducts=${rows.length} fingerprintBuckets=${byFingerprint.size} ` +
    `duplicateGroups=${duplicateGroups.length} multiStoreGroups=${multiStoreGroups.length} ` +
    `sample=${JSON.stringify(sample)}`,
  );

  // Bulk-fetch order-item counts + rashan pack refs across every product
  // that will appear in either result section.
  const productIds = [
    ...duplicateGroups.flatMap((g) => g.map((p) => p.id)),
    ...multiStoreGroups.flatMap((g) => g.map((p) => p.id)),
  ];
  const orderCountRows = productIds.length === 0
    ? []
    : await prisma.orderItem.groupBy({
        by: ['product_id'],
        where: { product_id: { in: productIds } },
        _count: { _all: true },
      });
  const orderCountByProduct = new Map<string, number>();
  for (const r of orderCountRows) orderCountByProduct.set(r.product_id, r._count._all);

  const packs = await prisma.rashanPack.findMany({
    where: { is_active: true },
    select: { name_es: true, items: true },
  });
  const packNamesByProduct = new Map<string, string[]>();
  for (const pack of packs) {
    const items = Array.isArray(pack.items)
      ? (pack.items as Array<{ product_id?: string } | null>)
      : [];
    for (const item of items) {
      const pid = item?.product_id;
      if (!pid) continue;
      const arr = packNamesByProduct.get(pid) ?? [];
      arr.push(pack.name_es);
      packNamesByProduct.set(pid, arr);
    }
  }

  // Shared group builder — same shape for duplicates and multi-store
  // listings so the frontend reuses its side-by-side comparison card.
  const buildGroup = (group: typeof rows) => {
    const products = group.map((p) => ({
      id: p.id,
      name_es: p.name_es,
      name_en: p.name_en,
      brand: p.brand,
      is_active: p.is_active,
      category_id: p.category_id,
      created_at: p.created_at,
      variant_count: p._count.variants,
      image_count: p._count.images,
      order_item_count: orderCountByProduct.get(p.id) ?? 0,
      rashan_pack_names: packNamesByProduct.get(p.id) ?? [],
      primary_image_url: (p.images[0]?.url ?? '').trim() || null,
      first_variant_name: normalize(p.variants[0]?.name_es ?? '') || null,
      store_id: p.store_id,
      store: p.store ?? null,
      variants: p.variants.map((v) => ({
        id: v.id,
        name_es: v.name_es,
        name_en: v.name_en,
        price: v.price.toString(),
        compare_at_price: v.compare_at_price ? v.compare_at_price.toString() : null,
        b2b_price: v.b2b_price ? v.b2b_price.toString() : null,
        stock_quantity: v.stock_quantity,
        sku: v.sku,
        is_default: v.is_default,
        is_active: v.is_active,
      })),
    }));
    // Stable key = earliest product's id. Label = its display name
    // (identity forces every name in the group to match after normalise,
    // so the earliest row's original casing is the natural canonical).
    const sortedByAge = [...group].sort(
      (a, b) => a.created_at.getTime() - b.created_at.getTime(),
    );
    const distinctStores = new Set(group.map((p) => p.store_id ?? '__cesto__'));
    return {
      key: sortedByAge[0].id,
      label: sortedByAge[0].name_es,
      is_cross_store: distinctStores.size >= 2,
      products,
    };
  };

  const groupsOut            = duplicateGroups.map(buildGroup);
  const multiStoreListingsOut = multiStoreGroups.map(buildGroup);

  return success(res, {
    groups: groupsOut,
    multi_store_listings: multiStoreListingsOut,
    total_groups: groupsOut.length,
    total_duplicate_products: groupsOut.reduce((n, g) => n + g.products.length, 0),
    total_multi_store_groups: multiStoreListingsOut.length,
    total_multi_store_products: multiStoreListingsOut.reduce((n, g) => n + g.products.length, 0),
  });
}));

// ─── POST /api/admin/products/duplicates/resolve ────────
// Body: { groups: [{ keep_id, remove_ids }] }. For each remove_id we
// deactivate if it has any OrderItem (preserves customer order history)
// and hard-delete otherwise (removes ProductImage + ProductVariant via
// cascade). Runs each product in isolation so a single bad row doesn't
// roll back the whole sweep.
const resolveDuplicatesSchema = z.object({
  groups: z.array(z.object({
    keep_id:    z.string().uuid(),
    remove_ids: z.array(z.string().uuid()).min(1),
  })).min(1).max(500),
});

duplicatesRouter.post('/resolve', validate(resolveDuplicatesSchema), asyncHandler(async (req, res) => {
  const { groups } = req.body as z.infer<typeof resolveDuplicatesSchema>;

  const removeIds = groups.flatMap((g) => g.remove_ids);
  if (removeIds.length === 0) {
    return success(res, {
      groups_processed: groups.length,
      deactivated: 0, deleted: 0,
      skipped: [], failed: [],
    });
  }

  // Rashan pack pre-check: any product referenced in an active pack's
  // items JSON is refused (both deactivation and deletion). Deactivating
  // would leave the pack pointing at an inactive product; deleting would
  // orphan the JSON reference entirely. Admin fixes the pack first, then
  // retries the resolve.
  const packs = await prisma.rashanPack.findMany({
    where: { is_active: true },
    select: { name_es: true, items: true },
  });
  const packNamesByProduct = new Map<string, string[]>();
  for (const pack of packs) {
    const items = Array.isArray(pack.items)
      ? (pack.items as Array<{ product_id?: string } | null>)
      : [];
    for (const item of items) {
      const pid = item?.product_id;
      if (!pid) continue;
      const arr = packNamesByProduct.get(pid) ?? [];
      arr.push(pack.name_es);
      packNamesByProduct.set(pid, arr);
    }
  }

  const skipped: Array<{ id: string; reason: string }> = [];
  const failed:  Array<{ id: string; error:  string }> = [];
  const safeRemoveIds = removeIds.filter((id) => {
    const packNames = packNamesByProduct.get(id);
    if (packNames && packNames.length > 0) {
      skipped.push({
        id,
        reason: `Referenced by active rashan pack${packNames.length === 1 ? '' : 's'}: ${packNames.join(', ')}. Remove from those packs before resolving.`,
      });
      return false;
    }
    return true;
  });

  // Split remaining into deactivate vs. hard-delete based on OrderItems.
  // OrderItem FKs both product_id and variant_id (no ON DELETE CASCADE),
  // so ANY historical order on this product means we soft-delete.
  const withOrders = safeRemoveIds.length === 0
    ? []
    : await prisma.orderItem.groupBy({
        by: ['product_id'],
        where: { product_id: { in: safeRemoveIds } },
        _count: { _all: true },
      });
  const withOrdersSet = new Set(withOrders.map((r) => r.product_id));

  invalidateCountCache();
  const toDeactivate = safeRemoveIds.filter((id) => withOrdersSet.has(id));
  const toDelete     = safeRemoveIds.filter((id) => !withOrdersSet.has(id));

  // A sales rep a duplicate was assigned to keeps selling the one kept
  // (lib/repStore): copied before the duplicates go or switch off.
  const keepOf = new Map(groups.flatMap((g) => g.remove_ids.map((id) => [id, g.keep_id] as const)));
  for (const id of safeRemoveIds) {
    const keep = keepOf.get(id);
    if (keep) await moveRepAssignments(prisma, id, keep);
  }

  let deactivated = 0;
  if (toDeactivate.length > 0) {
    const r = await prisma.product.updateMany({
      where: { id: { in: toDeactivate } },
      data: { is_active: false },
    });
    deactivated = r.count;
  }

  // Hard-delete loop. ProductImage + ProductVariant cascade via schema
  // ON DELETE CASCADE (see schema.prisma:414, :420) so we only need to
  // delete the product itself. Any error surfaces in `failed[]` instead
  // of going only to console — the admin sees which rows didn't take.
  let deleted = 0;
  for (const id of toDelete) {
    try {
      await prisma.product.delete({ where: { id } });
      deleted += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.warn(`[duplicates:resolve] failed to hard-delete ${id}: ${message}`);
      failed.push({ id, error: message });
    }
  }

  return success(res, {
    groups_processed: groups.length,
    deactivated,
    deleted,
    skipped,
    failed,
  });
}));

// ─── POST /duplicates/merge ─────────────────────────────
// Merge variants (+ images) from remove_ids INTO keep_id, then delete the
// now-empty remove products. Same request shape as /resolve so the UI can
// share its group-decision plumbing.
//
// Why merge instead of just delete? When two products are really the same
// SKU but got imported as separate rows carrying different sizes/prices,
// the admin's intent is "consolidate into one product with all sizes as
// variants". Reassigning `product_variant.product_id` preserves every
// OrderItem's FK (they reference variant_id, not product_id) so past
// order history stays intact and pointing at real data.
const mergeDuplicatesSchema = resolveDuplicatesSchema;
duplicatesRouter.post('/merge', validate(mergeDuplicatesSchema), asyncHandler(async (req, res) => {
  const { groups } = req.body as z.infer<typeof mergeDuplicatesSchema>;

  const removeIds = groups.flatMap((g) => g.remove_ids);
  if (removeIds.length === 0) {
    return success(res, {
      groups_processed: groups.length,
      merged_variants: 0, merged_images: 0, deleted: 0,
      skipped: [], failed: [],
    });
  }

  // Same rashan pre-check as /resolve — deleting a product referenced
  // by an active pack would orphan the JSON reference.
  const packs = await prisma.rashanPack.findMany({
    where: { is_active: true },
    select: { name_es: true, items: true },
  });
  const packNamesByProduct = new Map<string, string[]>();
  for (const pack of packs) {
    const items = Array.isArray(pack.items)
      ? (pack.items as Array<{ product_id?: string } | null>)
      : [];
    for (const item of items) {
      const pid = item?.product_id;
      if (!pid) continue;
      const arr = packNamesByProduct.get(pid) ?? [];
      arr.push(pack.name_es);
      packNamesByProduct.set(pid, arr);
    }
  }

  const skipped: Array<{ id: string; reason: string }> = [];
  const failed:  Array<{ id: string; error: string }>  = [];
  let mergedVariants = 0;
  let mergedImages   = 0;
  let deletedCount   = 0;

  for (const g of groups) {
    for (const removeId of g.remove_ids) {
      const packNames = packNamesByProduct.get(removeId);
      if (packNames && packNames.length > 0) {
        skipped.push({
          id: removeId,
          reason: `Referenced by active rashan pack${packNames.length === 1 ? '' : 's'}: ${packNames.join(', ')}. Remove from those packs before merging.`,
        });
        continue;
      }
      try {
        const moved = await prisma.$transaction(async (tx) => {
          // Reassign variants — this preserves every OrderItem.variant_id
          // FK because we only change the parent product_id, not the
          // variant's own id.
          const v = await tx.productVariant.updateMany({
            where: { product_id: removeId },
            data:  { product_id: g.keep_id },
          });
          // Same reassignment for images — they cluster on the canonical
          // so the admin can prune duplicates on the product form.
          const img = await tx.productImage.updateMany({
            where: { product_id: removeId },
            data:  { product_id: g.keep_id },
          });
          // A rep it was assigned to by hand keeps selling it as the
          // canonical (lib/repStore) — before the delete takes the rows.
          await moveRepAssignments(tx, removeId, g.keep_id);
          // Delete the now-empty shell product.
          await tx.product.delete({ where: { id: removeId } });
          // A B2B-only product keeps a B2B price on every size it sells
          // (lib/audience): sizes arriving without one roll this merge back.
          await assertB2bPriced(tx, g.keep_id);
          return { variants: v.count, images: img.count };
        });
        // Counted once it has committed — a merge rolled back moved nothing,
        // and the page reports these as "variants moved".
        mergedVariants += moved.variants;
        mergedImages += moved.images;
        deletedCount += 1;
      } catch (err) {
        if (err instanceof B2bPriceRequired) {
          skipped.push({ id: removeId, reason: 'The product kept is shown to B2B only, and this one has a size without a B2B price. Give it one before merging.' });
          continue;
        }
        const message = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.warn(`[duplicates:merge] failed for ${removeId}: ${message}`);
        failed.push({ id: removeId, error: message });
      }
    }
  }

  return success(res, {
    groups_processed: groups.length,
    merged_variants: mergedVariants,
    merged_images:   mergedImages,
    deleted:         deletedCount,
    skipped,
    failed,
  });
}));

export default router;
