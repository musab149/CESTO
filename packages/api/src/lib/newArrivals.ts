import { Prisma } from '@prisma/client';
import prisma from './prisma';
import { customerStoreVisibleProductFilter } from './store-scope';

/**
 * The home page's "New products" rail.
 *
 * ─── What this has to solve ─────────────────────────────────────────────
 *
 * `is_new_arrival` is an admin-curated flag, and it was made a flag on
 * purpose: the rail used to be "whatever was inserted most recently", so a
 * bulk import rewrote the shop front by accident. That decision was right,
 * but it left the rail EMPTY whenever nobody had curated anything — on this
 * catalogue, 6 products out of 2,099 carry the flag, and the home page hides
 * the section entirely when the list comes back empty. A dead rail in the
 * most valuable slot on the page helps nobody.
 *
 * So the rail now falls back to recent products — but not naively. Measured
 * on the real catalogue, the twelve most recently created products were all
 * from ONE category, inserted in the SAME MINUTE: one import. Shipping that
 * as "New products" would recreate the exact failure the flag was added to
 * prevent, which is why the fallback is diversified rather than a plain
 * `ORDER BY created_at DESC`.
 *
 * ─── The algorithm ──────────────────────────────────────────────────────
 *
 *  1. Curated first. Anything an admin flagged leads the rail, newest first.
 *     Their choice outranks anything inferred.
 *  2. Top up from a fallback pool, but only with products that can actually
 *     be SOLD and will LOOK right: active, in a visible store, at least one
 *     in-stock variant, and at least one image. A rail slot spent on an
 *     out-of-stock product with no photo is a slot that cannot convert.
 *  3. Diversify the top-up by category and brand (see `diversifyByRecency`)
 *     so one import cannot take the rail, and a shopper sees a spread of the
 *     catalogue rather than twelve variations of one thing.
 *  4. Recent means recent: the pool is limited to a window, widened only if
 *     that leaves the rail short, so a quiet month does not blank the rail.
 */

/** Everything the diversity pass needs to know about a candidate. */
export interface DiversityCandidate {
  id: string;
  category_id: string | null;
  brand: string | null;
}

export interface DiversityCaps {
  /** Most items from any one category. */
  perCategory: number;
  /** Most items from any one brand, compared case-insensitively. */
  perBrand: number;
}

export const DEFAULT_CAPS: DiversityCaps = { perCategory: 3, perBrand: 3 };

/** How far back "new" reaches before the window is widened. */
export const RECENCY_WINDOW_DAYS = 120;

/**
 * How many rows the cheap pool query reads. The pool has to be wide enough to
 * reach PAST a single bulk import — 400 rows is several imports deep on this
 * catalogue, and the query only selects three columns.
 */
const POOL_SIZE = 400;

/**
 * Greedy recency pass with per-category and per-brand caps.
 *
 * `candidates` must already be newest-first; this keeps that order and simply
 * declines an item once its category or brand is full. Walking newest-first
 * means the newest member of each group is the one that gets in, so a 500-row
 * import contributes its few best slots and then steps aside for older items
 * from elsewhere in the catalogue.
 *
 * A second pass re-admits capped-out items, newest first, if the caps left the
 * rail short. A full rail of slightly repetitive products beats a half-empty
 * one, and this only happens on a catalogue too narrow to diversify.
 *
 * Null brand is never capped: on an imported catalogue a large share of rows
 * have no brand, and treating "no brand" as one giant brand would starve the
 * rail. Null category is capped as its own bucket, since a product with no
 * category is the unusual case.
 */
export function diversifyByRecency<T extends DiversityCandidate>(
  candidates: T[],
  limit: number,
  caps: DiversityCaps = DEFAULT_CAPS,
): T[] {
  if (limit <= 0) return [];

  const byCategory = new Map<string, number>();
  const byBrand = new Map<string, number>();
  const picked: T[] = [];
  const skipped: T[] = [];

  // Brands are compared case-insensitively everywhere in this codebase —
  // "SHAN" and "Shan" are one brand, and capping them separately would let
  // the same brand in twice over.
  const brandKey = (b: string | null) => (b && b.trim() ? b.trim().toLowerCase() : null);

  for (const c of candidates) {
    if (picked.length >= limit) { skipped.push(c); continue; }

    const cat = c.category_id ?? '(none)';
    const brand = brandKey(c.brand);
    const catCount = byCategory.get(cat) ?? 0;
    const brandCount = brand ? byBrand.get(brand) ?? 0 : 0;

    if (catCount >= caps.perCategory || (brand !== null && brandCount >= caps.perBrand)) {
      skipped.push(c);
      continue;
    }

    picked.push(c);
    byCategory.set(cat, catCount + 1);
    if (brand) byBrand.set(brand, brandCount + 1);
  }

  if (picked.length < limit) {
    // Spread the overflow as well. Taking `skipped` in raw recency order would
    // pour the rail straight back into whichever group was capped hardest —
    // usually the import we were protecting against — so walk the skipped
    // items round-robin by category instead. Recency still decides the order
    // within each group.
    const groups = new Map<string, T[]>();
    for (const c of skipped) {
      const key = c.category_id ?? '(none)';
      const group = groups.get(key);
      if (group) group.push(c);
      else groups.set(key, [c]);
    }
    const queues = [...groups.values()];
    for (let i = 0; picked.length < limit && queues.some((q) => q.length > 0); i++) {
      const queue = queues[i % queues.length];
      const next = queue.shift();
      if (next) picked.push(next);
    }
  }

  return picked;
}

/** Products that can be bought today and will not render as a broken tile. */
function sellableWhere(shown: Prisma.ProductWhereInput = {}): Prisma.ProductWhereInput {
  return {
    is_active: true,
    ...customerStoreVisibleProductFilter,
    ...shown,
    // An out-of-stock product in the rail spends the slot and cannot convert.
    variants: { some: { is_active: true, stock_quantity: { gt: 0 } } },
    // A tile with no photo reads as broken, whatever the product is.
    images: { some: {} },
  };
}

/**
 * The rail, curated first and topped up with diversified recent products.
 *
 * `select` is passed in so the route keeps ownership of its own projection —
 * this file decides WHICH products, never what a product looks like on the
 * wire.
 */
export async function selectNewArrivals<S extends Prisma.ProductSelect>(opts: {
  limit: number;
  select: S;
  caps?: DiversityCaps;
  /** Only what this kind of customer is shown (lib/audience). */
  shown?: Prisma.ProductWhereInput;
}): Promise<Array<Prisma.Result<typeof prisma.product, { select: S }, 'findMany'>[number]>> {
  const { limit, select, caps = DEFAULT_CAPS, shown = {} } = opts;
  type Row = Prisma.Result<typeof prisma.product, { select: S }, 'findMany'>[number];

  const curated = (await prisma.product.findMany({
    where: { is_active: true, is_new_arrival: true, ...customerStoreVisibleProductFilter, ...shown },
    select,
    // Curated picks are NOT filtered for stock: an admin who flags a product
    // has made a deliberate call, and silently dropping it would leave them
    // editing a rail that ignores them.
    orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
    take: limit,
  })) as Row[];

  if (curated.length >= limit) return curated.slice(0, limit);

  const need = limit - curated.length;
  const curatedIds = new Set(curated.map((p) => (p as { id: string }).id));

  // Cheap pool: three columns, enough rows to see past one import.
  const poolWhere = (windowed: boolean): Prisma.ProductWhereInput => ({
    ...sellableWhere(shown),
    id: { notIn: [...curatedIds] },
    ...(windowed
      ? { created_at: { gte: new Date(Date.now() - RECENCY_WINDOW_DAYS * 24 * 60 * 60 * 1000) } }
      : {}),
  });

  const poolSelect = { id: true, category_id: true, brand: true } as const;
  let pool = await prisma.product.findMany({
    where: poolWhere(true),
    select: poolSelect,
    orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
    take: POOL_SIZE,
  });

  // A catalogue that has not been touched in months would otherwise blank the
  // rail. Recency is a preference here, not a requirement.
  if (pool.length < need) {
    pool = await prisma.product.findMany({
      where: poolWhere(false),
      select: poolSelect,
      orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
      take: POOL_SIZE,
    });
  }

  const chosen = diversifyByRecency(pool, need, caps);
  if (chosen.length === 0) return curated;

  const chosenIds = chosen.map((c) => c.id);
  const rows = (await prisma.product.findMany({
    where: { id: { in: chosenIds } },
    select,
  })) as Row[];

  // `IN` does not preserve order, and the diversity pass IS the order.
  const byId = new Map(rows.map((r) => [(r as { id: string }).id, r]));
  const ordered = chosenIds.map((id) => byId.get(id)).filter((r): r is Row => Boolean(r));

  return [...curated, ...ordered];
}
