import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { success, error } from '../lib/response';
import { asyncHandler } from '../lib/async';

const router = Router();

// ─── GET /api/product-types ──────────────────────────────
// Public read for cascading pickers on the storefront + product form.
// Almost always called with ?subcategoryId=… to scope the list to one
// subcategory. Only active product types are returned; inactive rows are
// admin-only (imported suggestions awaiting review, temporarily hidden, etc.)

const listQuerySchema = z.object({
  subcategoryId: z.string().uuid().optional(),
  /** Optional wider filter — join through subcategory to include every product
   *  type under a whole category. Useful when we want "all types under Food"
   *  regardless of which subcategory owns each. */
  categoryId:    z.string().uuid().optional(),
}).passthrough();

router.get('/', asyncHandler(async (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return error(res, parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '), 422);
  }
  const { subcategoryId, categoryId } = parsed.data;

  const where: Prisma.ProductTypeWhereInput = { is_active: true };
  if (subcategoryId) where.subcategory_id = subcategoryId;
  if (categoryId)    where.subcategory = { category_id: categoryId };

  const rows = await prisma.productType.findMany({
    where,
    select: {
      id: true,
      subcategory_id: true,
      name_es: true,
      name_en: true,
      sort_order: true,
    },
    orderBy: [{ sort_order: 'asc' }, { name_es: 'asc' }],
  });
  return success(res, rows);
}));

export default router;
