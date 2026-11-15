import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import prisma from '../../lib/prisma';
import { B2bPriceRequired, assertB2bPriced, b2bPriceRequiredBody } from '../../lib/audience';
import { success, error } from '../../lib/response';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/async';
import { assertOwnStore, ForbiddenResourceError } from '../../middleware/partnerAuth';
import { parsePage, paged } from '../../lib/pagination';
import { invalidateCountCache } from '../../lib/count-cache';

const router = Router();

// Variant + image schemas mirror admin's ([admin/products.ts:12/37]) so a
// shared UI can post the same body shape here. store_id is intentionally
// NOT in the create/update schema — we force it from the JWT.

const variantSchema = z.object({
  id: z.string().uuid().optional(),
  name_es: z.string().min(1),
  name_en: z.string().min(1),
  price: z.number().positive(),
  compare_at_price: z.number().positive().nullable().optional(),
  b2b_price: z.number().positive().nullable().optional(),
  stock_quantity: z.number().int().min(0).default(0),
  low_stock_threshold: z.number().int().min(0).default(10),
  is_default: z.boolean().default(false),
  is_active: z.boolean().default(true),
  sku: z.string().nullable().optional(),
});

const imageUrlSchema = z
  .string()
  .min(1)
  .refine((s) => /^(https?:\/\/|\/|data:|blob:)/.test(s), { message: 'Must be a URL or a server path starting with /' });

const imageSchema = z.object({
  id: z.string().uuid().optional(),
  url: imageUrlSchema,
  alt_text: z.string().nullable().optional(),
  sort_order: z.number().int().default(0),
  is_primary: z.boolean().default(false),
});

// Partner cannot set is_verified / is_top_seller / is_sponsored / is_featured —
// those are Cesto's marketing signals. Rating fields are customer-authored.
const productWriteSchema = z.object({
  name_es: z.string().min(1),
  name_en: z.string().min(1),
  description_es: z.string().nullable().optional(),
  description_en: z.string().nullable().optional(),
  brand: z.string().nullable().optional(),
  origin: z.string().nullable().optional(),
  category_id: z.string().uuid(),
  subcategory_id: z.string().uuid().nullable().optional(),
  product_type_id: z.string().uuid().nullable().optional(),
  is_active: z.boolean().default(true),
  variants: z.array(variantSchema).min(1),
  images: z.array(imageSchema).default([]),
});

const listQuerySchema = z.object({
  q: z.string().max(200).optional(),
  categoryId: z.string().uuid().optional(),
  subcategoryId: z.string().uuid().optional(),
  productTypeId: z.string().uuid().optional(),
  brandId: z.string().uuid().optional(),
  originId: z.string().uuid().optional(),
  isActive: z.enum(['true', 'false']).optional(),
  stock: z.enum(['in', 'out', 'low']).optional(),
  hasOrders: z.enum(['true', 'false']).optional(),
  sort: z.enum(['newest', 'oldest', 'name_asc', 'name_desc', 'rating_desc']).optional(),
}).passthrough();

/** Match admin's list response so the shared frontend hook can consume both. */
const productSelect = {
  id: true, name_es: true, name_en: true, brand: true, brand_id: true, origin: true, origin_id: true, store_id: true,
  is_active: true, is_featured: true, is_sponsored: true, created_at: true,
  is_verified: true, is_top_seller: true, rating: true, rating_count: true,
  // The band the prices are charged at (2026-11-05): the order editor prices a
  // product picked from this list as the customer pays it, base + IVA, so the
  // line it adds reads what the server will save. Additive for older clients.
  vat_category: true, vat_category_reviewed: true,
  category: { select: { id: true, name_es: true } },
  store: { select: { id: true, slug: true, name: true } },
  brand_ref:  { select: { id: true, name: true, slug: true, logo_url: true, logo_bg: true } },
  origin_ref: { select: { id: true, key: true, label_es: true, label_en: true } },
  // Same is_active filter as GET /:id — a deleted variant was still
  // contributing its price and stock to the list row.
  variants: { where: { is_active: true }, select: { id: true, price: true, compare_at_price: true, b2b_price: true, stock_quantity: true, low_stock_threshold: true, is_default: true } },
  images: { where: { is_primary: true }, select: { url: true }, take: 1 },
} as const;

// Same resolver admin uses — free-text brand/origin → FK id. Doesn't
// auto-create (that's importer-only), so partners get null when they type
// something not in the curated list.
async function resolveProductRefs(brand: string | null, origin: string | null) {
  let brand_id: string | null = null;
  let origin_id: string | null = null;
  if (brand?.trim()) {
    const row = await prisma.brand.findFirst({
      where: { name: { equals: brand.trim(), mode: 'insensitive' } },
      select: { id: true },
    });
    brand_id = row?.id ?? null;
  }
  if (origin?.trim()) {
    const row = await prisma.origin.findFirst({
      where: {
        OR: [
          { key:      { equals: origin.trim(), mode: 'insensitive' } },
          { label_es: { equals: origin.trim(), mode: 'insensitive' } },
          { label_en: { equals: origin.trim(), mode: 'insensitive' } },
        ],
      },
      select: { id: true },
    });
    origin_id = row?.id ?? null;
  }
  return { brand_id, origin_id };
}

// ─── GET /api/partner/products ─────────────────────────

router.get('/', asyncHandler(async (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return error(res, parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '), 422);
  }
  const p = parsePage(req.query, 20, 100);
  const { q, categoryId, subcategoryId, productTypeId, brandId, originId, isActive, stock, hasOrders, sort } = parsed.data;

  const where: Prisma.ProductWhereInput = {
    // ALWAYS scope to the partner's own store. No override.
    store_id: req.partnerRole!.store.id,
  };
  if (categoryId) where.category_id = categoryId;
  if (subcategoryId) where.subcategory_id = subcategoryId;
  if (productTypeId) where.product_type_id = productTypeId;
  if (brandId) where.brand_id = brandId;
  if (originId) where.origin_id = originId;
  if (isActive !== undefined) where.is_active = isActive === 'true';
  if (q) {
    where.OR = [
      { name_es: { contains: q, mode: 'insensitive' } },
      { name_en: { contains: q, mode: 'insensitive' } },
      { brand:   { contains: q, mode: 'insensitive' } },
    ];
  }
  if (stock === 'in')  where.variants = { some: { stock_quantity: { gt: 0 } } };
  if (stock === 'out') where.variants = { every: { stock_quantity: { lte: 0 } } };
  if (stock === 'low') where.variants = { some: { stock_quantity: { gt: 0, lte: 10 } } };
  if (hasOrders === 'true')  where.order_items = { some: {} };
  if (hasOrders === 'false') where.order_items = { none: {} };

  let orderBy: Prisma.ProductOrderByWithRelationInput | Prisma.ProductOrderByWithRelationInput[];
  switch (sort) {
    case 'oldest':      orderBy = { created_at: 'asc' };                          break;
    case 'name_asc':    orderBy = [{ name_es: 'asc' },  { name_en: 'asc' }];      break;
    case 'name_desc':   orderBy = [{ name_es: 'desc' }, { name_en: 'desc' }];     break;
    case 'rating_desc': orderBy = [{ rating: 'desc' }, { rating_count: 'desc' }]; break;
    case 'newest':
    default:            orderBy = { created_at: 'desc' };                         break;
  }

  const [items, total] = await Promise.all([
    prisma.product.findMany({ where, select: productSelect, orderBy, skip: p.skip, take: p.limit }),
    prisma.product.count({ where }),
  ]);
  return success(res, paged(items, total, p));
}));

// ─── GET /api/partner/products/:id ─────────────────────

router.get('/:id', asyncHandler(async (req, res) => {
  const product = await prisma.product.findUnique({
    where: { id: req.params.id },
    include: {
      // Deleting a variant soft-disables it (see PUT below — the row is kept
      // so OrderItem history still resolves). Returning those here put the
      // deleted row back into the edit form on the next open, which read as
      // the delete having silently failed. The form has no concept of a
      // disabled variant and no way to restore one.
      variants: { where: { is_active: true } },
      images: { orderBy: { sort_order: 'asc' } },
      category: { select: { id: true, name_es: true, name_en: true } },
      brand_ref:  { select: { id: true, name: true, slug: true } },
      origin_ref: { select: { id: true, key: true, label_es: true, label_en: true } },
    },
  });
  try {
    assertOwnStore(product, req.partnerRole!.store.id);
  } catch (e) {
    if (e instanceof ForbiddenResourceError) return error(res, 'Product not found.', 404);
    throw e;
  }
  return success(res, product);
}));

// ─── POST /api/partner/products ────────────────────────

router.post('/', validate(productWriteSchema), asyncHandler(async (req, res) => {
  const { variants, images, ...rest } = req.body as z.infer<typeof productWriteSchema>;
  const refs = await resolveProductRefs(rest.brand ?? null, rest.origin ?? null);

  const product = await prisma.product.create({
    data: {
      ...rest,
      // Force store_id from the JWT — never trust the body.
      store_id:  req.partnerRole!.store.id,
      // Slice 7 cleanup: is_test lets us nuke partner-created rows en masse
      // once we're ready to cut over.
      brand_id:  refs.brand_id,
      origin_id: refs.origin_id,
      variants: { create: variants.map(({ id: _i, ...v }) => v) },
      images:   { create: images.map(({ id: _i, ...img }) => img) },
    },
    include: { variants: true, images: true },
  });
  invalidateCountCache();
  return success(res, product, 201);
}));

// ─── PATCH /api/partner/products/:id ───────────────────
// Same body shape as POST. Wholesale variant + image reconciliation, same
// as admin's PUT (variants missing from payload get is_active=false, images
// replaced wholesale).

/** A variant id in a partner's edit belonged to some other product. */
class NotThisProductsSize extends Error {}

router.patch('/:id', validate(productWriteSchema), asyncHandler(async (req, res) => {
  const productId = req.params.id;
  const { variants, images, ...rest } = req.body as z.infer<typeof productWriteSchema>;

  // Ownership check BEFORE any writes.
  const existing = await prisma.product.findUnique({ where: { id: productId }, select: { id: true, store_id: true } });
  try {
    assertOwnStore(existing, req.partnerRole!.store.id);
  } catch (e) {
    if (e instanceof ForbiddenResourceError) return error(res, 'Product not found.', 404);
    throw e;
  }

  const refs = await resolveProductRefs(rest.brand ?? null, rest.origin ?? null);

  const updated = await prisma.$transaction(async (tx) => {
    await tx.product.update({
      where: { id: productId },
      // store_id NOT in the update — the partner can't reassign to another
      // store.
      data:  { ...rest, brand_id: refs.brand_id, origin_id: refs.origin_id },
    });

    const keepVariantIds: string[] = [];
    for (const v of variants) {
      const { id, ...data } = v;
      if (id) {
        // Scoped by product, not updated by id alone: variant ids come from
        // the client, and every size's id is public in the shop's payloads,
        // so an unscoped write let a partner rewrite the price or stock of
        // any size in the catalogue — Cesto's included — by sending it
        // against their own product.
        const r = await tx.productVariant.updateMany({ where: { id, product_id: productId }, data });
        if (r.count === 0) throw new NotThisProductsSize();
        keepVariantIds.push(id);
      } else {
        const created = await tx.productVariant.create({ data: { ...data, product_id: productId } });
        keepVariantIds.push(created.id);
      }
    }
    // is_default cleared alongside is_active: the payload sets that flag on
    // a surviving row, so leaving it on the removed one left the product
    // with two defaults in the table.
    await tx.productVariant.updateMany({
      where: { product_id: productId, id: { notIn: keepVariantIds } },
      data:  { is_active: false, is_default: false },
    });

    await tx.productImage.deleteMany({ where: { product_id: productId } });
    if (images.length > 0) {
      await tx.productImage.createMany({
        data: images.map(({ id: _i, ...img }) => ({ ...img, product_id: productId })),
      });
    }
    // Cesto may show this product to business accounts only (lib/audience),
    // which the partner cannot change; then every size it sells keeps a B2B
    // price, so emptying one, or adding a size without one, is refused.
    await assertB2bPriced(tx, productId);

    return tx.product.findUnique({
      where: { id: productId },
      include: { variants: true, images: { orderBy: { sort_order: 'asc' } } },
    });
  }).catch((err: unknown) => {
    if (err instanceof NotThisProductsSize || err instanceof B2bPriceRequired) return err;
    throw err;
  });
  if (updated instanceof NotThisProductsSize) return error(res, 'That size is not one of this product\'s.', 422);
  if (updated instanceof B2bPriceRequired) {
    return error(res, 'Cesto shows this product to business accounts only, so every size needs a B2B price.', 422, b2bPriceRequiredBody(updated));
  }
  return success(res, updated);
}));


// ─── DELETE /api/partner/products/:id ──────────────────
// Soft-delete only (is_active=false). Hard delete + purge are admin-only —
// they can break order history and other partners' catalogues in edge
// cases (shared brand/origin refs).

router.delete('/:id', asyncHandler(async (req, res) => {
  const productId = req.params.id;
  const existing = await prisma.product.findUnique({ where: { id: productId }, select: { store_id: true } });
  try {
    assertOwnStore(existing, req.partnerRole!.store.id);
  } catch (e) {
    if (e instanceof ForbiddenResourceError) return error(res, 'Product not found.', 404);
    throw e;
  }
  await prisma.product.update({ where: { id: productId }, data: { is_active: false } });
  return success(res, { message: 'Product deactivated.' });
}));

export default router;
