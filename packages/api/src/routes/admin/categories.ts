import { Router } from 'express';
import { z } from 'zod';
import prisma from '../../lib/prisma';
import { success, error } from '../../lib/response';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/async';

const router = Router();

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

const categorySchema = z.object({
  name_es: z.string().min(1),
  name_en: z.string().min(1),
  icon_url: imageUrlSchema.nullable().optional(),
  bg_color: hexColorSchema.nullable().optional(),
  accent_color: hexColorSchema.nullable().optional(),
  sort_order: z.number().int().default(0),
  is_active: z.boolean().default(true),
});

const subcategorySchema = z.object({
  category_id: z.string().uuid(),
  name_es: z.string().min(1),
  name_en: z.string().min(1),
  sort_order: z.number().int().default(0),
  is_active: z.boolean().default(true),
});

// ─── Categories ─────────────────────────────────────────

router.get('/', asyncHandler(async (_req, res) => {
  const categories = await prisma.category.findMany({
    // Partner submissions awaiting/denied review live in their own queue
    // (GET /partner-submissions) — keep them out of the main table, same
    // as import-sourced pending rows living in PendingCategory, not here.
    where: { approval_status: 'approved' },
    include: {
      _count: { select: { subcategories: true, products: true } },
    },
    orderBy: { sort_order: 'asc' },
  });
  // Group pending products by category_name_key so we can attach a count to
  // every Category whose name matches (either language). One extra query keeps
  // this list-page-cheap; the publish modal pulls the actual rows on demand.
  const pendingGroups = await prisma.pendingProduct.groupBy({
    by: ['category_name_key'],
    _count: { _all: true },
  });
  const pendingByKey = new Map(pendingGroups.map((g) => [g.category_name_key, g._count._all]));
  const enriched = categories.map((c) => {
    const a = pendingByKey.get(c.name_es.trim().toLowerCase()) ?? 0;
    const b = pendingByKey.get(c.name_en.trim().toLowerCase()) ?? 0;
    return { ...c, pending_products_count: a + b };
  });
  return success(res, enriched);
}));

router.post('/', validate(categorySchema), asyncHandler(async (req, res) => {
  const created = await prisma.category.create({ data: req.body });
  // Auto-clear any pending-category entries that match this name (either lang),
  // so admins don't have to dismiss the chip after promoting it.
  const nameKeys = [created.name_es, created.name_en]
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (nameKeys.length > 0) {
    await prisma.pendingCategory.deleteMany({
      where: { name: { in: nameKeys, mode: 'insensitive' } },
    });
  }
  // Surface the count of parked products whose category just became real,
  // so the admin UI can prompt the user to publish them.
  const pendingProductsCount = nameKeys.length > 0
    ? await prisma.pendingProduct.count({
        where: { category_name_key: { in: nameKeys } },
      })
    : 0;
  return success(res, { ...created, pending_products_count: pendingProductsCount }, 201);
}));

router.put('/:id', validate(categorySchema), asyncHandler(async (req, res) => {
  const updated = await prisma.category.update({ where: { id: req.params.id }, data: req.body });
  return success(res, updated);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const categoryId = req.params.id;
  const reassignTo = (req.query.reassignTo as string | undefined)?.trim() || undefined;

  const productCount = await prisma.product.count({ where: { category_id: categoryId } });

  // No products → straight delete (also wipes empty subcategories)
  if (productCount === 0) {
    await prisma.$transaction([
      prisma.subCategory.deleteMany({ where: { category_id: categoryId } }),
      prisma.category.delete({ where: { id: categoryId } }),
    ]);
    return success(res, { message: 'Category deleted.', moved: 0 });
  }

  // Has products → caller must pick a destination
  if (!reassignTo) {
    return error(
      res,
      `Category has ${productCount} products. Provide ?reassignTo=<categoryId> to move them, or deactivate the category instead.`,
      409,
    );
  }

  if (reassignTo === categoryId) {
    return error(res, 'reassignTo must differ from the category being deleted.', 400);
  }

  const target = await prisma.category.findUnique({ where: { id: reassignTo } });
  if (!target) return error(res, 'Reassignment target category not found.', 404);

  // Move products + detach their subcategories (subcats belong to old parent),
  // then delete old subcategories + category. All-or-nothing.
  await prisma.$transaction([
    prisma.product.updateMany({
      where: { category_id: categoryId },
      data: { category_id: reassignTo, subcategory_id: null },
    }),
    prisma.subCategory.deleteMany({ where: { category_id: categoryId } }),
    prisma.category.delete({ where: { id: categoryId } }),
  ]);

  return success(res, { message: 'Category deleted and products reassigned.', moved: productCount });
}));

// ─── Partner category submissions (approval queue) ──────
// Categories a partner submitted from their dashboard (source='partner'),
// parked as approval_status='pending' + is_active=false until an admin
// reviews them. See docs/MULTIVENDOR_ROADMAP.md Ground Rule 9.

router.get('/partner-submissions', asyncHandler(async (req, res) => {
  const status = (req.query.status as string | undefined) ?? 'pending';
  const parsed = z.enum(['pending', 'approved', 'rejected']).safeParse(status);
  if (!parsed.success) return error(res, 'Invalid status filter.', 422);

  const submissions = await prisma.category.findMany({
    where: { source: 'partner', approval_status: parsed.data },
    include: {
      submitted_by_store: { select: { id: true, name: true, slug: true } },
    },
    orderBy: { created_at: 'desc' },
  });
  return success(res, submissions);
}));

const rejectSchema = z.object({ reason: z.string().min(1) });

router.post('/:id/approve', validate(categorySchema.partial()), asyncHandler(async (req, res) => {
  const existing = await prisma.category.findUnique({ where: { id: req.params.id } });
  if (!existing) return error(res, 'Category not found.', 404);

  const updated = await prisma.category.update({
    where: { id: req.params.id },
    data: {
      ...req.body,
      approval_status: 'approved',
      is_active: true,
      reviewed_at: new Date(),
      reviewed_by_admin_id: req.admin!.adminId,
    },
  });
  return success(res, updated);
}));

router.post('/:id/reject', validate(rejectSchema), asyncHandler(async (req, res) => {
  const existing = await prisma.category.findUnique({ where: { id: req.params.id } });
  if (!existing) return error(res, 'Category not found.', 404);

  const updated = await prisma.category.update({
    where: { id: req.params.id },
    data: {
      approval_status: 'rejected',
      is_active: false,
      rejection_reason: req.body.reason,
      reviewed_at: new Date(),
      reviewed_by_admin_id: req.admin!.adminId,
    },
  });
  return success(res, updated);
}));

// ─── Pending categories (queued from the Excel import) ──

router.get('/pending', asyncHandler(async (_req, res) => {
  const pending = await prisma.pendingCategory.findMany({
    orderBy: [{ source_row_count: 'desc' }, { last_seen_at: 'desc' }],
  });
  return success(res, pending);
}));

router.delete('/pending/:id', asyncHandler(async (req, res) => {
  await prisma.pendingCategory.delete({ where: { id: req.params.id } });
  return success(res, { message: 'Pending category dismissed.' });
}));

// ─── Pending products (parked rows from the Excel import) ──
// Same idea as PendingCategory but for the product payloads themselves.
// Listed and published per-Category so admins see them in context.

// GET /api/admin/categories/:id/pending-products
// Returns the queued products whose raw category name (es or en) matches
// the given Category. Used by the post-create publish modal AND by the
// "N waiting" badge on the categories table row.
router.get('/:id/pending-products', asyncHandler(async (req, res) => {
  const cat = await prisma.category.findUnique({ where: { id: req.params.id } });
  if (!cat) return error(res, 'Category not found.', 404);
  const nameKeys = [cat.name_es, cat.name_en].map((s) => s.trim().toLowerCase()).filter(Boolean);
  const items = await prisma.pendingProduct.findMany({
    where: { category_name_key: { in: nameKeys } },
    orderBy: { created_at: 'asc' },
  });
  return success(res, items);
}));

// POST /api/admin/categories/:id/pending-products/publish
// body: { ids: string[], subcategory_id?: string | null }
// Converts the named PendingProducts into real Products under this Category
// (and the chosen Subcategory, if any). Each conversion is its own create —
// a failure on one row doesn't roll back the others, but the row is left in
// place so the admin can retry. Returns per-row results.
const publishSchema = z.object({
  ids: z.array(z.string().uuid()).min(1),
  subcategory_id: z.string().uuid().nullable().optional(),
});
router.post('/:id/pending-products/publish', validate(publishSchema), asyncHandler(async (req, res) => {
  const cat = await prisma.category.findUnique({ where: { id: req.params.id } });
  if (!cat) return error(res, 'Category not found.', 404);

  const { ids, subcategory_id } = req.body as z.infer<typeof publishSchema>;

  // Confirm the requested subcategory belongs to this category — otherwise
  // we'd be linking products to a sub from a different parent.
  if (subcategory_id) {
    const sub = await prisma.subCategory.findUnique({ where: { id: subcategory_id } });
    if (!sub || sub.category_id !== cat.id) {
      return error(res, 'Subcategory does not belong to this category.', 400);
    }
  }

  const pendings = await prisma.pendingProduct.findMany({ where: { id: { in: ids } } });
  if (pendings.length === 0) return success(res, { published: 0, failed: 0, results: [] });

  // Resolve PendingProduct.shop_id (slug) → Store.id (uuid) for the whole
  // batch in one query. Unknown / missing slug → null (Cesto default).
  const slugs = Array.from(new Set(
    pendings.map((p) => p.shop_id).filter((s): s is string => Boolean(s)),
  ));
  const stores = slugs.length === 0 ? [] : await prisma.store.findMany({
    where: { slug: { in: slugs } },
    select: { id: true, slug: true },
  });
  const storeIdBySlug = new Map(stores.map((s) => [s.slug, s.id]));

  interface VariantBlob {
    name_es: string;
    name_en: string;
    price: number;
    compare_at_price: number | null;
    stock_quantity: number;
    low_stock_threshold: number;
    sku: string | null;
    is_default: boolean;
    is_active: boolean;
  }

  const results: Array<{
    id: string;
    product_key: string;
    name_es: string;
    status: 'published' | 'error';
    productId?: string;
    error?: string;
  }> = [];

  for (const p of pendings) {
    try {
      const variants = (p.variants as unknown as VariantBlob[]) ?? [];
      const imageUrls = (p.image_urls as unknown as string[]) ?? [];

      const created = await prisma.product.create({
        data: {
          name_es:        p.name_es,
          name_en:        p.name_en,
          description_es: p.description_es,
          description_en: p.description_en,
          brand:          p.brand,
          origin:         p.origin,
          store_id:       p.shop_id ? (storeIdBySlug.get(p.shop_id) ?? null) : null,
          category_id:    cat.id,
          subcategory_id: subcategory_id ?? null,
          is_active:      p.is_active,
          is_featured:    p.is_featured,
          variants: {
            create: variants.map((v) => ({
              name_es:             v.name_es,
              name_en:             v.name_en,
              price:               v.price,
              compare_at_price:    v.compare_at_price,
              b2b_price:           (v as { b2b_price?: number | null }).b2b_price ?? null,
              stock_quantity:      v.stock_quantity,
              low_stock_threshold: v.low_stock_threshold,
              sku:                 v.sku,
              is_default:          v.is_default,
              is_active:           v.is_active,
            })),
          },
          images: {
            create: imageUrls.map((url, i) => ({
              url,
              sort_order: i,
              is_primary: i === 0,
            })),
          },
        },
        select: { id: true },
      });
      await prisma.pendingProduct.delete({ where: { id: p.id } });
      results.push({ id: p.id, product_key: p.product_key, name_es: p.name_es, status: 'published', productId: created.id });
    } catch (e) {
      results.push({ id: p.id, product_key: p.product_key, name_es: p.name_es, status: 'error', error: (e as Error).message });
    }
  }

  const published = results.filter((r) => r.status === 'published').length;
  const failed = results.filter((r) => r.status === 'error').length;
  return success(res, { published, failed, results });
}));

// DELETE /api/admin/categories/pending-products/:id
// Dismiss one queued product without publishing it.
router.delete('/pending-products/:id', asyncHandler(async (req, res) => {
  await prisma.pendingProduct.delete({ where: { id: req.params.id } });
  return success(res, { message: 'Pending product dismissed.' });
}));

// ─── Subcategories ──────────────────────────────────────

router.get('/subcategories/all', asyncHandler(async (_req, res) => {
  const subs = await prisma.subCategory.findMany({
    include: { category: { select: { id: true, name_es: true } } },
    orderBy: [{ category_id: 'asc' }, { sort_order: 'asc' }],
  });
  return success(res, subs);
}));

router.post('/subcategories', validate(subcategorySchema), asyncHandler(async (req, res) => {
  const created = await prisma.subCategory.create({ data: req.body });
  return success(res, created, 201);
}));

router.put('/subcategories/:id', validate(subcategorySchema), asyncHandler(async (req, res) => {
  const updated = await prisma.subCategory.update({ where: { id: req.params.id }, data: req.body });
  return success(res, updated);
}));

router.delete('/subcategories/:id', asyncHandler(async (req, res) => {
  const subId = req.params.id;
  // Detach products from this subcategory (they keep their parent category),
  // then delete. Atomic.
  const [{ count: detached }] = await prisma.$transaction([
    prisma.product.updateMany({ where: { subcategory_id: subId }, data: { subcategory_id: null } }),
    prisma.subCategory.delete({ where: { id: subId } }),
  ]);
  return success(res, { message: 'Subcategory deleted.', detached });
}));

export default router;
