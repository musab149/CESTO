import { z } from 'zod';
import { Prisma } from '@prisma/client';

/**
 * Shared catalogue filter schema + `where` builder.
 *
 * Lives here rather than in the products route because the bulk-action
 * endpoint has to resolve "everything matching this filter" to exactly the
 * same rows the products table counted. Two copies of this logic would drift
 * — the `stock`/`lowStock` alias and the `stock:'out'` `every:` semantics are
 * both easy to mis-copy.
 */
export const productFilterSchema = z.object({
  q: z.string().max(200).optional(),
  categoryId: z.string().uuid().optional(),
  subcategoryId: z.string().uuid().optional(),
  productTypeId: z.string().uuid().optional(),
  // 'cesto' is the sentinel for the house store (Product.store_id NULL) —
  // a query string can't carry a real null, and scoping a picker to "Cesto
  // only" has to be expressible (see admin EditOrderModal's ProductPicker).
  storeId: z.union([z.literal('cesto'), z.string().uuid()]).optional(),
  brandId: z.string().uuid().optional(),
  originId: z.string().uuid().optional(),
  isActive: z.enum(['true', 'false']).optional(),
  isFeatured: z.enum(['true', 'false']).optional(),
  isVerified: z.enum(['true', 'false']).optional(),
  isTopSeller: z.enum(['true', 'false']).optional(),
  isSponsored: z.enum(['true', 'false']).optional(),
  /** The quick-create review queue: rows a rep added that still need a
   *  catalogue admin to finish them. */
  reviewNeeded: z.enum(['true', 'false']).optional(),
  // `stock` supersedes the older `lowStock` flag. Kept lowStock as a legacy
  // alias so any in-flight admin bundle mid-deploy keeps working.
  stock: z.enum(['in', 'out', 'low']).optional(),
  lowStock: z.enum(['true', 'false']).optional(),
  hasOrders: z.enum(['true', 'false']).optional(),
  /** Exactly this audience setting — the products table's "Shown to" filter. */
  audience: z.enum(['all', 'b2c', 'b2b']).optional(),
  /**
   * What one kind of customer is shown: both-audience products and their own
   * (lib/audience). The order builders pass the customer's kind, so a panel
   * offers what that customer could buy in the shop.
   */
  shownTo: z.enum(['b2c', 'b2b']).optional(),
});

export type ProductFilterParams = z.infer<typeof productFilterSchema>;

export function buildProductWhere(f: ProductFilterParams): Prisma.ProductWhereInput {
  const where: Prisma.ProductWhereInput = {};
  if (f.categoryId) where.category_id = f.categoryId;
  if (f.subcategoryId) where.subcategory_id = f.subcategoryId;
  if (f.productTypeId) where.product_type_id = f.productTypeId;
  if (f.storeId) where.store_id = f.storeId === 'cesto' ? null : f.storeId;
  if (f.brandId) where.brand_id = f.brandId;
  if (f.originId) where.origin_id = f.originId;
  if (f.isActive !== undefined)    where.is_active     = f.isActive === 'true';
  if (f.reviewNeeded !== undefined) where.review_needed = f.reviewNeeded === 'true';
  if (f.isFeatured !== undefined)  where.is_featured   = f.isFeatured === 'true';
  if (f.isVerified !== undefined)  where.is_verified   = f.isVerified === 'true';
  if (f.isTopSeller !== undefined) where.is_top_seller = f.isTopSeller === 'true';
  if (f.isSponsored !== undefined) where.is_sponsored  = f.isSponsored === 'true';
  if (f.q) {
    where.OR = [
      { name_es: { contains: f.q, mode: 'insensitive' } },
      { name_en: { contains: f.q, mode: 'insensitive' } },
      { brand:   { contains: f.q, mode: 'insensitive' } },
    ];
  }

  // Resolve the tri-state 'stock' param first, fall back to the legacy
  // 'lowStock' flag if the caller hasn't been updated yet.
  const stockMode: 'in' | 'out' | 'low' | undefined =
    f.stock ?? (f.lowStock === 'true' ? 'low' : undefined);
  if (stockMode === 'in') {
    where.variants = { some: { stock_quantity: { gt: 0 } } };
  } else if (stockMode === 'out') {
    // Every variant zero — includes products with no variants at all.
    where.variants = { every: { stock_quantity: { lte: 0 } } };
  } else if (stockMode === 'low') {
    where.variants = { some: { stock_quantity: { gt: 0, lte: 10 } } };
  }

  if (f.hasOrders === 'true')  where.order_items = { some: {} };
  if (f.hasOrders === 'false') where.order_items = { none: {} };

  // A plain field either way, so neither collides with the `q` OR above.
  if (f.audience) where.audience = f.audience;
  else if (f.shownTo) where.audience = { in: ['all', f.shownTo] };

  return where;
}
