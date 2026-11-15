import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { success, error } from '../../lib/response';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/async';
import { invalidateCountCache } from '../../lib/count-cache';
import { productFilterSchema, buildProductWhere } from '../../lib/product-filters';
import { resolveProductRefs } from '../../lib/product-refs';
import { B2bPriceRequired, NO_B2B_PRICE, assertB2bPriced } from '../../lib/audience';

const router = Router();

/** Max products the bulk-edit grid loads (and the patch endpoint accepts). */
export const BULK_EDIT_MAX_PRODUCTS = 250;
/** Ceiling for a filter-scoped quick action. Mirrors MAX_EXPORT_ROWS. */
const MAX_FILTER_ACTION_ROWS = 20_000;

// ─── POST /api/admin/products/bulk ──────────────────────
// Partial patch. Unlike PUT /:id (which validates the whole productSchema and
// so forces a read-modify-write), every field here is optional — the grid
// sends only the cells the admin actually touched.

// .strict() is deliberate. On a partial API an unknown key like `is_activee`
// would otherwise be silently dropped and the admin would believe the save
// worked. Strict turns the typo into a 422.
const variantPatchSchema = z.object({
  id: z.string().uuid(),
  name_es: z.string().min(1).optional(),
  price: z.number().positive().optional(),
  compare_at_price: z.number().positive().nullable().optional(),
  b2b_price: z.number().positive().nullable().optional(),
  /** The buying price (admin only). */
  cost_price: z.number().min(0).max(100000).optional(),
  stock_quantity: z.number().int().min(0).optional(),
  low_stock_threshold: z.number().int().min(0).optional(),
  is_default: z.boolean().optional(),
  sku: z.string().trim().max(64).nullable().optional(),
}).strict();

const productPatchSchema = z.object({
  name_es: z.string().min(1).optional(),
  name_en: z.string().min(1).optional(),
  description_es: z.string().nullable().optional(),
  description_en: z.string().nullable().optional(),
  brand: z.string().nullable().optional(),
  origin: z.string().nullable().optional(),
  store_id: z.string().uuid().nullable().optional(),
  category_id: z.string().uuid().optional(),
  subcategory_id: z.string().uuid().nullable().optional(),
  product_type_id: z.string().uuid().nullable().optional(),
  is_active: z.boolean().optional(),
  is_featured: z.boolean().optional(),
  is_verified: z.boolean().optional(),
  is_top_seller: z.boolean().optional(),
  is_sponsored: z.boolean().optional(),
  is_new_arrival: z.boolean().optional(),
  rating: z.number().min(0).max(5).nullable().optional(),
  rating_count: z.number().int().min(0).optional(),
  /** Reviewed by the act of being set here — see products.ts. */
  vat_category: z.enum(['zero', 'super_reduced', 'reduced', 'general']).optional(),
}).strict();

const bulkUpdateSchema = z.object({
  items: z.array(
    z.object({
      id: z.string().uuid(),
      product: productPatchSchema.optional(),
      variants: z.array(variantPatchSchema).max(50).optional(),
    }).refine(
      (i) => (i.product && Object.keys(i.product).length > 0) || (i.variants?.length ?? 0) > 0,
      { message: 'item has nothing to update' },
    ),
  ).min(1).max(BULK_EDIT_MAX_PRODUCTS),
});

type ProductPatch = z.infer<typeof productPatchSchema>;
type BulkItem = z.infer<typeof bulkUpdateSchema>['items'][number];

/**
 * Keep category → subcategory → product_type consistent.
 *
 * Bulk-setting `category_id` alone would otherwise leave hundreds of rows
 * pointing at a subcategory belonging to a different category — silent
 * taxonomy corruption that nothing surfaces until the storefront filters
 * come back empty. Where the chain breaks we null the downstream field
 * rather than failing the row, so a bulk recategorise still succeeds.
 *
 * The grid clears downstream fields client-side too, but the server can't
 * trust that.
 */
async function reconcileTaxonomy(
  tx: Prisma.TransactionClient,
  productId: string,
  patch: ProductPatch,
  data: Prisma.ProductUncheckedUpdateInput,
): Promise<void> {
  const touchesTaxonomy =
    'category_id' in patch || 'subcategory_id' in patch || 'product_type_id' in patch;
  if (!touchesTaxonomy) return;

  const current = await tx.product.findUniqueOrThrow({
    where: { id: productId },
    select: { category_id: true, subcategory_id: true, product_type_id: true },
  });

  const categoryId    = 'category_id'    in patch ? patch.category_id!    : current.category_id;
  let   subcategoryId = 'subcategory_id' in patch ? patch.subcategory_id! : current.subcategory_id;
  let   productTypeId = 'product_type_id' in patch ? patch.product_type_id! : current.product_type_id;

  if (subcategoryId) {
    const sub = await tx.subCategory.findUnique({
      where: { id: subcategoryId },
      select: { category_id: true },
    });
    if (!sub || sub.category_id !== categoryId) {
      subcategoryId = null;
      data.subcategory_id = null;
    }
  }

  if (productTypeId) {
    const pt = await tx.productType.findUnique({
      where: { id: productTypeId },
      select: { subcategory_id: true },
    });
    if (!pt || !subcategoryId || pt.subcategory_id !== subcategoryId) {
      productTypeId = null;
      data.product_type_id = null;
    }
  }
}

async function applyItem(item: BulkItem): Promise<number> {
  let variantsUpdated = 0;

  await prisma.$transaction(async (tx) => {
    if (item.product && Object.keys(item.product).length > 0) {
      const patch = item.product;
      const data: Prisma.ProductUncheckedUpdateInput = { ...patch };
      if (patch.vat_category !== undefined) data.vat_category_reviewed = true;

      // Free-text brand/origin carry FK mirrors that must stay in sync.
      // Read whichever side wasn't patched so the resolver sees both.
      if ('brand' in patch || 'origin' in patch) {
        const current = await tx.product.findUniqueOrThrow({
          where: { id: item.id },
          select: { brand: true, origin: true },
        });
        const refs = await resolveProductRefs(
          'brand'  in patch ? patch.brand  ?? null : current.brand,
          'origin' in patch ? patch.origin ?? null : current.origin,
        );
        if ('brand'  in patch) data.brand_id  = refs.brand_id;
        if ('origin' in patch) data.origin_id = refs.origin_id;
      }

      await reconcileTaxonomy(tx, item.id, patch, data);
      await tx.product.update({ where: { id: item.id }, data });
    }

    for (const v of item.variants ?? []) {
      const { id, ...vdata } = v;
      // The UI never exposes variant name_en — mirror name_es, same as the
      // single-product form does.
      const payload: Prisma.ProductVariantUncheckedUpdateInput = { ...vdata };
      if (vdata.name_es !== undefined) payload.name_en = vdata.name_es;

      // updateMany scoped by product_id, not update by id: variant ids are
      // client-supplied, so an unscoped write would let a crafted payload
      // patch a variant belonging to a different product.
      const r = await tx.productVariant.updateMany({
        where: { id, product_id: item.id },
        data: payload,
      });
      if (r.count === 0) throw new Error(`Variant ${id} does not belong to product ${item.id}`);
      variantsUpdated += r.count;
    }

    // A B2B-only product keeps a B2B price on every size (lib/audience):
    // clearing one fails this row, and the grid says why.
    if ((item.variants ?? []).some((v) => 'b2b_price' in v)) {
      try {
        await assertB2bPriced(tx, item.id);
      } catch (err) {
        if (err instanceof B2bPriceRequired) throw new Error('A B2B-only product needs a B2B price on every size.');
        throw err;
      }
    }

    // Exactly one default per product. PUT /:id already had this bug once.
    const newDefault = (item.variants ?? []).find((v) => v.is_default === true);
    if (newDefault) {
      await tx.productVariant.updateMany({
        where: { product_id: item.id, id: { not: newDefault.id } },
        data: { is_default: false },
      });
    }
  });

  return variantsUpdated;
}

/**
 * Short, client-safe reason for a failed row. Prisma's own messages embed a
 * multi-line stack with absolute server paths — not something to hand back to
 * the admin UI, which renders this string in a toast.
 */
function describeFailure(err: unknown): string {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2025') return 'Product not found.';
    if (err.code === 'P2003') return 'References a category, store or brand that no longer exists.';
    if (err.code === 'P2002') return 'Duplicate value.';
    return `Database error (${err.code}).`;
  }
  if (err instanceof Error) return err.message.split('\n')[0].slice(0, 200);
  return 'Unknown error.';
}

router.post('/', validate(bulkUpdateSchema), asyncHandler(async (req, res) => {
  const { items } = req.body as z.infer<typeof bulkUpdateSchema>;
  const failed: Array<{ id: string; error: string }> = [];
  let updated = 0;
  let variantsUpdated = 0;
  let touchesActive = false;

  // Per-item transaction, no batch-wide one — the house pattern (see the
  // importer and /duplicates/resolve) so one bad row can't roll back the rest.
  for (const item of items) {
    try {
      variantsUpdated += await applyItem(item);
      if (item.product && 'is_active' in item.product) touchesActive = true;
      updated += 1;
    } catch (err) {
      failed.push({ id: item.id, error: describeFailure(err) });
    }
  }

  if (touchesActive) invalidateCountCache();
  return success(res, { updated, variants_updated: variantsUpdated, failed });
}));

// ─── POST /api/admin/products/bulk/action ───────────────
// One-click actions from the selection bar. Accepts either an explicit id
// list or a filter — the latter is how "select all N matching" applies to
// rows the client never loaded.

const bulkActionSchema = z.object({
  /**
   * `set_vat` is filter-scoped on purpose. The catalogue is thousands of
   * products and the IVA band is decided per category, not per product —
   * staples at 4%, most food at 10%, everything else at 21%. Filtering to a
   * category and setting its band is the shape of the real task; doing it
   * 250 at a time through the grid is the same work with more clicking.
   */
  action: z.enum(['activate', 'deactivate', 'delete', 'set_vat', 'set_audience']),
  ids: z.array(z.string().uuid()).min(1).max(1000).optional(),
  filter: productFilterSchema.optional(),
  vat_category: z.enum(['zero', 'super_reduced', 'reduced', 'general']).optional(),
  /** For `set_audience`: who the shop shows them to (lib/audience). */
  audience: z.enum(['all', 'b2c', 'b2b']).optional(),
}).refine(
  (b) => (b.ids ? 1 : 0) + (b.filter ? 1 : 0) === 1,
  { message: 'provide exactly one of ids or filter' },
).refine(
  (b) => b.action !== 'set_vat' || !!b.vat_category,
  { message: 'set_vat requires vat_category' },
).refine(
  (b) => b.action !== 'set_audience' || !!b.audience,
  { message: 'set_audience requires audience' },
);

router.post('/action', validate(bulkActionSchema), asyncHandler(async (req, res) => {
  const { action, ids, filter, vat_category, audience } = req.body as z.infer<typeof bulkActionSchema>;

  // Permanent delete needs the per-product OrderItem safety check that
  // DELETE /:id does, so bulk delete is soft only — and filter-scoped delete
  // is refused outright: too easy to deactivate a catalogue by accident.
  if (action === 'delete' && !ids) {
    return error(res, 'Bulk delete requires an explicit id list.', 422);
  }

  const where: Prisma.ProductWhereInput = ids ? { id: { in: ids } } : buildProductWhere(filter!);
  const matched = await prisma.product.count({ where });

  if (matched > MAX_FILTER_ACTION_ROWS) {
    return error(res, `Too many products matched (${matched}). Narrow the filter to ${MAX_FILTER_ACTION_ROWS} or fewer.`, 422);
  }
  if (matched === 0) {
    return success(res, { matched: 0, updated: 0 });
  }

  if (action === 'set_vat') {
    const result = await prisma.product.updateMany({
      where,
      data: { vat_category: vat_category!, vat_category_reviewed: true },
    });
    // No count-cache touch: this changes no product's visibility.
    return success(res, { matched, updated: result.count });
  }

  if (action === 'set_audience') {
    // B2B only needs a B2B price on every size (lib/audience). Those without
    // one are left as they are and named, so the admin can price them. AND,
    // not a spread: the filter's own `variants` condition must survive.
    if (audience === 'b2b') {
      const priced: Prisma.ProductWhereInput = { AND: [where, { variants: { none: NO_B2B_PRICE } }] };
      const unpriced: Prisma.ProductWhereInput = { AND: [where, { variants: { some: NO_B2B_PRICE } }] };
      const result = await prisma.product.updateMany({ where: priced, data: { audience } });
      const [needsCount, needs] = await Promise.all([
        prisma.product.count({ where: unpriced }),
        prisma.product.findMany({ where: unpriced, select: { id: true, name_es: true }, orderBy: { name_es: 'asc' }, take: 50 }),
      ]);
      invalidateCountCache();
      return success(res, { matched, updated: result.count, needs_b2b_price: needsCount, needs_b2b_price_products: needs });
    }
    const result = await prisma.product.updateMany({ where, data: { audience: audience! } });
    // Counts the shop shows depend on who is shown what.
    invalidateCountCache();
    return success(res, { matched, updated: result.count });
  }

  // 'delete' is a soft delete — same default as DELETE /:id, which keeps
  // order history resolvable.
  const isActive = action === 'activate';
  const result = await prisma.product.updateMany({ where, data: { is_active: isActive } });

  invalidateCountCache();
  return success(res, { matched, updated: result.count });
}));

export default router;
