// ─── Stable pagination ordering ────────────────────────────
//
// Offset pagination (`skip`/`take`) is only correct when the ORDER BY is a
// total order. Postgres makes no promise about how it breaks ties, and it is
// free to break them differently between two queries — so with a sort that
// has ties, page 2 can re-show a row from page 1 and silently skip another.
// The skipped row is then unreachable: no page ever contains it.
//
// This is not hypothetical here. Measured against the local catalogue of
// 2,098 products, paging 40 at a time:
//
//   sort=name_asc  → 2,094 / 2,098   (949 duplicate name_es values)
//   sort=popular   → 2,073 / 2,098   (every product has rating_count = 0,
//                                     so the whole sort is one tie)
//   sort=newest    → 2,098 / 2,098   (created_at happens to be near-unique
//                                     locally — luck, not a guarantee: a bulk
//                                     import writes many rows in one instant)
//
// Appending the primary key makes every one of them complete, because `id` is
// unique so no tie survives it. The cost is nothing: it only decides the
// order of rows that were already equal.
//
// This went unnoticed while every list ended in a "Load more" button that
// most shoppers never exhausted. Infinite scroll walks to the last page every
// time, which is what surfaced it.

import { Prisma } from '@prisma/client';

/**
 * Append a primary-key tiebreaker to a product ordering.
 *
 * Accepts the single-object or array form, and the loosely-typed orderBy the
 * category/search/storefront routes build (they use shapes like
 * `{ variants: { _min: { price: 'asc' } } }` that don't fit
 * `ProductOrderByWithRelationInput` cleanly).
 *
 *   orderBy: stableProductOrder({ name_es: 'asc' })
 *   → [{ name_es: 'asc' }, { id: 'asc' }]
 */
export function stableProductOrder(
  orderBy: Prisma.ProductOrderByWithRelationInput | Prisma.ProductOrderByWithRelationInput[] | Record<string, unknown>,
): Prisma.ProductOrderByWithRelationInput[] {
  const list = Array.isArray(orderBy) ? orderBy : [orderBy];
  return [...list, { id: 'asc' }] as Prisma.ProductOrderByWithRelationInput[];
}
