import type { Prisma } from '@prisma/client';
import { customerStoreVisibleProductFilter } from './store-scope';
import { shownToWhere } from './audience';

/**
 * What a business buyer's catalogue holds (2026-10-29).
 *
 * The user: "B2B catalog is where all the products in our system will show
 * with their b2b price mentioned" — and, asked what to do with a product that
 * has no wholesale price yet: "Only products with a B2B price". So a product
 * is in it when the shop would show it to a business AND at least one of its
 * active sizes has a wholesale price; and only those sizes are offered.
 *
 * The shop's own visibility rules are reused, never restated: the store must
 * be customer-visible (lib/store-scope; Cesto's own products have no store)
 * and the product shown to B2B (lib/audience). AND-ed as separate clauses so
 * each keeps its own `OR` (feedback: two `where.OR`s overwrite each other).
 */
export const B2B_SIZE: Prisma.ProductVariantWhereInput = { is_active: true, b2b_price: { not: null } };

export const businessProductScope: Prisma.ProductWhereInput = {
  AND: [
    { is_active: true },
    customerStoreVisibleProductFilter,
    shownToWhere('b2b'),
    { variants: { some: B2B_SIZE } },
  ],
};

/** A filtered `where` with the business scope added on — it narrows, never widens. */
export function withBusinessScope(where: Prisma.ProductWhereInput): Prisma.ProductWhereInput {
  const own = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : [];
  return { ...where, AND: [...own, businessProductScope] };
}
