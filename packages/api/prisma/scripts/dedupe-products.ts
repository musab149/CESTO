/**
 * Remove visually-identical duplicate products from the local DB.
 *
 * Two products are considered duplicates if they match on (lower-cased
 * name_en, lower-cased name_es, lower-cased brand, category_id,
 * subcategory_id, shop_id). The oldest row (by created_at) is kept; the
 * rest are candidates for deletion.
 *
 * Safety rules:
 *   - Dry run by default. Pass --apply to actually delete.
 *   - Any candidate referenced by an OrderItem is SKIPPED — deleting
 *     would break order history (Order ↔ Product is a non-cascade FK).
 *   - ProductVariant and ProductImage cascade on Product delete, so
 *     they clean themselves up.
 *
 * Run with:
 *   pnpm --filter @grocery-app/api exec ts-node prisma/scripts/dedupe-products.ts
 *   pnpm --filter @grocery-app/api exec ts-node prisma/scripts/dedupe-products.ts --apply
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

type ProductRow = {
  id: string;
  name_en: string;
  name_es: string;
  brand: string | null;
  category_id: string;
  subcategory_id: string | null;
  shop_id: string | null;
  created_at: Date;
};

function key(p: ProductRow): string {
  return [
    p.name_en.trim().toLowerCase(),
    p.name_es.trim().toLowerCase(),
    (p.brand ?? '').trim().toLowerCase(),
    p.category_id,
    p.subcategory_id ?? '',
    p.shop_id ?? '',
  ].join('|');
}

async function main() {
  console.log(`▶ dedupe-products  (${APPLY ? 'APPLY' : 'dry-run'})`);

  const products = await prisma.product.findMany({
    select: {
      id: true,
      name_en: true,
      name_es: true,
      brand: true,
      category_id: true,
      subcategory_id: true,
      shop_id: true,
      created_at: true,
    },
    orderBy: { created_at: 'asc' },
  });
  console.log(`  scanned ${products.length} product rows`);

  const groups = new Map<string, ProductRow[]>();
  for (const p of products) {
    const k = key(p);
    const arr = groups.get(k);
    if (arr) arr.push(p);
    else groups.set(k, [p]);
  }

  const duplicateGroups = Array.from(groups.values()).filter((g) => g.length > 1);
  console.log(`  found ${duplicateGroups.length} duplicate groups`);
  if (duplicateGroups.length === 0) {
    console.log('  ✓ nothing to do');
    return;
  }

  let kept = 0;
  let toDelete = 0;
  let skipped = 0;
  const deletable: string[] = [];
  const skippedDetails: { id: string; name_en: string; orderItems: number }[] = [];

  for (const group of duplicateGroups) {
    // group is already ordered oldest-first because we sorted by created_at
    const [keep, ...rest] = group;
    kept += 1;

    console.log(`\n  • "${keep.name_en}" — ${group.length} copies`);
    console.log(`      keep:   ${keep.id}  (created ${keep.created_at.toISOString()})`);

    for (const dup of rest) {
      const refs = await prisma.orderItem.count({ where: { product_id: dup.id } });
      if (refs > 0) {
        console.log(`      skip:   ${dup.id}  — referenced by ${refs} order item(s)`);
        skipped += 1;
        skippedDetails.push({ id: dup.id, name_en: dup.name_en, orderItems: refs });
        continue;
      }
      console.log(`      drop:   ${dup.id}  (created ${dup.created_at.toISOString()})`);
      deletable.push(dup.id);
      toDelete += 1;
    }
  }

  console.log('\n─── summary ─────────────────────────────────');
  console.log(`  groups       : ${duplicateGroups.length}`);
  console.log(`  kept         : ${kept}`);
  console.log(`  to delete    : ${toDelete}`);
  console.log(`  skipped (FK) : ${skipped}`);

  if (!APPLY) {
    console.log('\n  dry-run only — re-run with --apply to perform deletes.');
    return;
  }

  if (deletable.length === 0) {
    console.log('\n  nothing to delete.');
    return;
  }

  const result = await prisma.product.deleteMany({ where: { id: { in: deletable } } });
  console.log(`\n  ✓ deleted ${result.count} product rows (variants + images cascade)`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
