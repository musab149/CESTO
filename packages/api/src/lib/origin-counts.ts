import type { Prisma } from '@prisma/client';
import prisma from './prisma';

/**
 * Real product count per origin. Merges two data paths:
 *
 *  1. FK match — Product.origin_id === origin.id
 *  2. String match — Product.origin (case-insensitive) matches any of
 *     origin.key / label_es / label_en, ONLY for products that don't
 *     already have an origin_id set (so we don't double-count).
 *
 * Both paths exist because origins were promoted to first-class rows on
 * 2026-07-13 but the free-text `origin` column stayed as a denormalised
 * fallback (see pending-deploy-notes "Brands + Origins first-class").
 * Only counting one path leaves legitimate products missing on either the
 * admin or the customer surface — this helper is the single source of
 * truth for both.
 */
export async function computeOriginProductCounts(
  productFilter: Prisma.ProductWhereInput = {},
): Promise<Map<string, number>> {
  const [origins, fkGroups, stringGroups] = await Promise.all([
    prisma.origin.findMany({
      select: { id: true, key: true, label_es: true, label_en: true },
    }),
    prisma.product.groupBy({
      by: ['origin_id'],
      where: { origin_id: { not: null }, ...productFilter },
      _count: { _all: true },
    }),
    // Restrict to `origin_id IS NULL` so products with both a FK and a
    // string only count once (through the FK branch above).
    prisma.product.groupBy({
      by: ['origin'],
      where: { origin_id: null, origin: { not: null }, ...productFilter },
      _count: { _all: true },
    }),
  ]);

  const fkCountById = new Map<string, number>(
    fkGroups.map((r) => [r.origin_id as string, r._count._all]),
  );
  const strCountByLower = new Map<string, number>();
  for (const g of stringGroups) {
    const raw = (g.origin ?? '').trim();
    if (!raw) continue;
    const k = raw.toLowerCase();
    strCountByLower.set(k, (strCountByLower.get(k) ?? 0) + g._count._all);
  }

  const out = new Map<string, number>();
  for (const o of origins) {
    // Dedupe aliases so an origin whose key / label_es / label_en overlap
    // (case-insensitively) doesn't count the same string group twice.
    const aliases = new Set<string>();
    aliases.add(o.key.toLowerCase());
    aliases.add(o.label_es.toLowerCase());
    if (o.label_en) aliases.add(o.label_en.toLowerCase());
    let strTotal = 0;
    for (const alias of aliases) strTotal += strCountByLower.get(alias) ?? 0;
    out.set(o.id, (fkCountById.get(o.id) ?? 0) + strTotal);
  }
  return out;
}
