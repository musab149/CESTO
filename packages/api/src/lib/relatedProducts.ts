import { Prisma } from '@prisma/client';
import prisma from './prisma';
import { customerStoreVisibleProductFilter } from './store-scope';

/**
 * "You might also like", on a product page.
 *
 * It used to be the FEATURED list with the current product filtered out — the
 * same six products under every product in the catalogue, related to nothing.
 *
 * What a shopper actually wants, in order:
 *
 *  1. THIS product somewhere else. On a multi-vendor catalogue the same item
 *     is often listed by several shops at different prices, and "the same
 *     thing, from another shop" is the most useful row on the page.
 *  2. Failing that, things genuinely like it — narrowest taxonomy first, so
 *     someone looking at basmati rice sees other rice before other pasta.
 *
 * Tiers fill in order until the limit is reached, so a product listed by two
 * other shops still fills the rest of the row with neighbours rather than
 * showing two items and a gap.
 */

/** Only products someone can buy, and that will not render as a broken tile. */
function sellable(excludeIds: string[]): Prisma.ProductWhereInput {
  return {
    is_active: true,
    id: { notIn: excludeIds },
    variants: { some: { is_active: true, stock_quantity: { gt: 0 } } },
    images: { some: {} },
  };
}

/**
 * Brand values that carry no information.
 *
 * Imports fill this column with placeholders rather than leaving it null —
 * "No Brand" alone covers 67 products in this catalogue, spanning bin bags,
 * pizza boxes and polystyrene. Treating that as a brand makes the same-brand
 * tier group unrelated things, and makes the same-product match FAIL against
 * a twin whose brand is genuinely null.
 */
const BRAND_PLACEHOLDERS = new Set([
  '', '-', '--', 'n/a', 'na', 'none', 'no brand', 'nobrand', 'unbranded',
  'generic', 'sin marca', 'varios',
]);

/** The brand if it says something, else null. */
function meaningfulBrand(brand: string | null): string | null {
  const b = (brand ?? '').trim();
  return b && !BRAND_PLACEHOLDERS.has(b.toLowerCase()) ? b : null;
}

/** Popular first. A related product nobody buys is a poor recommendation. */
const POPULAR_FIRST: Prisma.ProductOrderByWithRelationInput[] = [
  { rating_count: 'desc' },
  { rating: 'desc' },
  { id: 'asc' },
];

export type RelatedReason =
  /** The same product, listed by a different shop. */
  | 'same_product_other_store'
  | 'same_product_type'
  | 'same_subcategory'
  | 'same_brand'
  | 'same_category';

export interface RelatedSource {
  id: string;
  name_es: string;
  brand: string | null;
  store_id: string | null;
  category_id: string | null;
  subcategory_id: string | null;
  product_type_id: string | null;
}

/**
 * "A shop that is not this one", including the Cesto house store.
 *
 * Not `{ store_id: { not: x } }`: that compiles to `NOT (store_id = x)`, and
 * in SQL a NULL store_id makes that NULL rather than true — so every house
 * product would be dropped from the results when viewing a partner's. House
 * products are exactly the ones a shopper most wants to see here.
 */
function otherStoreThan(storeId: string | null): Prisma.ProductWhereInput {
  if (storeId === null) return { store_id: { not: null } };
  return { OR: [{ store_id: null }, { store_id: { not: storeId } }] };
}

/**
 * `select` is passed in so the route keeps ownership of its projection —
 * this file decides WHICH products, never what one looks like on the wire.
 */
export async function findRelatedProducts<S extends Prisma.ProductSelect>(opts: {
  product: RelatedSource;
  limit: number;
  select: S;
  /** Only what this kind of customer is shown (lib/audience). */
  shown?: Prisma.ProductWhereInput;
}): Promise<Array<Prisma.Result<typeof prisma.product, { select: S }, 'findMany'>[number] & { related_reason: RelatedReason }>> {
  const { product, limit, select, shown = {} } = opts;
  type Row = Prisma.Result<typeof prisma.product, { select: S }, 'findMany'>[number];

  const picked: Array<Row & { related_reason: RelatedReason }> = [];
  const seen = new Set<string>([product.id]);

  const take = async (reason: RelatedReason, tier: Prisma.ProductWhereInput | null) => {
    if (tier === null) return;                  // this tier does not apply
    const remaining = limit - picked.length;
    if (remaining <= 0) return;

    // AND, never a spread. `customerStoreVisibleProductFilter` is itself an
    // `OR`, and so is the other-stores fragment — spreading two objects that
    // both carry `OR` silently keeps one and drops the other, which here
    // would mean serving products from deactivated shops.
    const rows = (await prisma.product.findMany({
      where: { AND: [sellable([...seen]), customerStoreVisibleProductFilter, shown, tier] },
      select,
      orderBy: POPULAR_FIRST,
      take: remaining,
    })) as Row[];

    for (const row of rows) {
      const id = (row as { id: string }).id;
      if (seen.has(id)) continue;
      seen.add(id);
      picked.push({ ...row, related_reason: reason });
    }
  };

  const brand = meaningfulBrand(product.brand);

  // ── 1. The same product, from someone else ───────────────
  //
  // The NAME carries the match; the brand only disambiguates when both sides
  // have a real one. Requiring the brand outright was wrong on real data: the
  // two listings of "1 PAN BOLSA 9+4+52" in this catalogue are the same item
  // in two shops, and one says "No Brand" while the other says nothing at all,
  // so an equality check found neither.
  //
  // Accent drift ("Acéite" vs "Aceite") still misses. Acceptable — a miss
  // costs a slot the tiers below fill, while a looser match would put a
  // DIFFERENT product under "the same item, elsewhere".
  await take('same_product_other_store', {
    AND: [
      { name_es: { equals: product.name_es, mode: 'insensitive' } },
      ...(brand ? [{
        OR: [
          { brand: { equals: brand, mode: 'insensitive' as const } },
          // A twin that simply has no brand recorded is still the twin.
          { brand: null },
          { brand: '' },
        ],
      }] : []),
      otherStoreThan(product.store_id),
    ],
  });

  // ── 2..5. Narrowest taxonomy first ───────────────────────
  await take('same_product_type', product.product_type_id ? { product_type_id: product.product_type_id } : null);
  await take('same_subcategory', product.subcategory_id ? { subcategory_id: product.subcategory_id } : null);
  // Skipped for a placeholder brand — "more No Brand products" is not a
  // recommendation, it is 67 unrelated rows.
  await take('same_brand', brand ? { brand: { equals: brand, mode: 'insensitive' } } : null);
  await take('same_category', product.category_id ? { category_id: product.category_id } : null);

  return picked;
}
