import type { Prisma } from '@prisma/client';
import prisma from './prisma';

/*
 * TESTS ONLY. A sales rep sells only from the shops an admin assigns them
 * (lib/repStore, 2026-10-25), so a test whose rep builds orders gives them
 * one, and picks its products from it.
 */

/**
 * The shop with the most active products that have this much stock — null
 * for Cesto's own catalogue when that has the most. Matches `where` too, so a
 * test's other conditions on the variant still hold.
 */
export async function busiestShop(where: Prisma.ProductVariantWhereInput = {}): Promise<string | null> {
  const rows = await prisma.productVariant.findMany({
    where: { is_active: true, product: { is_active: true }, ...where },
    select: { product: { select: { store_id: true } } },
    take: 5000,
  });
  const counts = new Map<string | null, number>();
  for (const r of rows) counts.set(r.product.store_id, (counts.get(r.product.store_id) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/** The rep's shop, for `salesRep.create`: a shop's id, or null for Cesto's own catalogue. */
export function repShop(storeId: string | null): Pick<Prisma.SalesRepUncheckedCreateInput, 'house_store' | 'stores'> {
  return storeId ? { house_store: false, stores: { create: [{ store_id: storeId }] } } : { house_store: true };
}
