import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { success, error } from '../../lib/response';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/async';

const router = Router();

// ─── Zod schemas ────────────────────────────────────────

const createSchema = z.object({
  subcategory_id: z.string().uuid(),
  name_es:        z.string().min(1).max(200),
  name_en:        z.string().min(1).max(200),
  sort_order:     z.number().int().default(0),
  is_active:      z.boolean().default(true),
});

// Update: subcategory_id is immutable once created (moving a product type
// between subcategories would silently orphan its products). Admin can
// delete + recreate under a different subcategory instead.
const updateSchema = z.object({
  name_es:    z.string().min(1).max(200).optional(),
  name_en:    z.string().min(1).max(200).optional(),
  sort_order: z.number().int().optional(),
  is_active:  z.boolean().optional(),
});

const reorderSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
});

const listQuerySchema = z.object({
  subcategoryId: z.string().uuid().optional(),
  categoryId:    z.string().uuid().optional(),
  isActive:      z.enum(['true', 'false']).optional(),
  source:        z.enum(['manual', 'import']).optional(),
}).passthrough();

// ─── Routes ─────────────────────────────────────────────

// GET /api/admin/product-types
// List with optional filters. When categoryId is passed we join through
// the subcategory to filter — handy for the CategoriesPage row where we
// want every product type belonging to a category regardless of which
// subcategory owns it.
router.get('/', asyncHandler(async (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return error(res, parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '), 422);
  }
  const { subcategoryId, categoryId, isActive, source } = parsed.data;

  const where: Prisma.ProductTypeWhereInput = {};
  if (subcategoryId) where.subcategory_id = subcategoryId;
  if (categoryId)    where.subcategory = { category_id: categoryId };
  if (isActive !== undefined) where.is_active = isActive === 'true';
  if (source) where.source = source;

  const rows = await prisma.productType.findMany({
    where,
    include: {
      subcategory: { select: { id: true, name_es: true, name_en: true, category_id: true } },
      _count: { select: { products: { where: { is_active: true } } } },
    },
    orderBy: [{ subcategory_id: 'asc' }, { sort_order: 'asc' }, { name_es: 'asc' }],
  });
  return success(res, rows);
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const row = await prisma.productType.findUnique({
    where: { id: req.params.id },
    include: {
      subcategory: { select: { id: true, name_es: true, name_en: true, category_id: true } },
      _count: { select: { products: true } },
    },
  });
  if (!row) return error(res, 'Product type not found.', 404);
  return success(res, row);
}));

router.post('/', validate(createSchema), asyncHandler(async (req, res) => {
  const payload = req.body as z.infer<typeof createSchema>;
  // Refuse if the parent subcategory doesn't exist — Prisma would P2003 on
  // FK violation but that error is opaque; return a clean 422.
  const sub = await prisma.subCategory.findUnique({
    where: { id: payload.subcategory_id },
    select: { id: true },
  });
  if (!sub) return error(res, 'Parent subcategory not found.', 422);
  const created = await prisma.productType.create({ data: payload });
  return success(res, created, 201);
}));

router.put('/:id', validate(updateSchema), asyncHandler(async (req, res) => {
  try {
    const updated = await prisma.productType.update({
      where: { id: req.params.id },
      data: req.body as z.infer<typeof updateSchema>,
    });
    return success(res, updated);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      return error(res, 'Product type not found.', 404);
    }
    throw e;
  }
}));

// DELETE — SetNull on products.product_type_id is the DB-level guarantee
// per the schema: products stay parked under their subcategory. No manual
// UPDATE needed here.
router.delete('/:id', asyncHandler(async (req, res) => {
  try {
    // Report how many products were detached so admin gets a clear
    // "3 products moved back to subcategory Y" message in the UI.
    const detachedCount = await prisma.product.count({
      where: { product_type_id: req.params.id },
    });
    await prisma.productType.delete({ where: { id: req.params.id } });
    return success(res, {
      message: 'Product type deleted.',
      detached: detachedCount,
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      return error(res, 'Product type not found.', 404);
    }
    throw e;
  }
}));

// POST /reorder — bulk sort_order update, ids in the new display order.
// Wrapped in a transaction so partial reorders can't happen.
router.post('/reorder', validate(reorderSchema), asyncHandler(async (req, res) => {
  const { ids } = req.body as z.infer<typeof reorderSchema>;
  await prisma.$transaction(
    ids.map((id, idx) =>
      prisma.productType.update({ where: { id }, data: { sort_order: idx } }),
    ),
  );
  return success(res, { reordered: ids.length });
}));

export default router;
