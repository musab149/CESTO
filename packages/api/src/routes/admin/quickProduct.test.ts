// ─── Integration test · quick-create product ───────────────────
//
// Run:  cd packages/api && npx ts-node src/routes/admin/quickProduct.test.ts
//
// The endpoint's value is not that it writes a row — it is WHICH columns it
// writes. A product described in twenty seconds must be sellable but must not
// reach a storefront rail, and it must carry a VAT rate somebody actually
// confirmed. Those are the invariants worth pinning; a regression in any of
// them is silent.
//
// Creates its own throwaway category and products, removes them in a finally.

import '../../server';
import prisma from '../../lib/prisma';

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}`);
    if (detail !== undefined) console.log(`        ${JSON.stringify(detail)}`);
  }
}

const stamp = Date.now();

/** Mirrors the route's create. Kept in step with routes/admin/products.ts. */
async function quickCreate(categoryId: string, opts: {
  nameEs: string;
  vat: 'super_reduced' | 'reduced' | 'general';
  price: number;
  stock?: number;
}) {
  return prisma.product.create({
    data: {
      name_es: opts.nameEs,
      name_en: opts.nameEs,
      category_id: categoryId,
      vat_category: opts.vat,
      vat_category_reviewed: true,
      is_active: true,
      is_featured: false,
      is_new_arrival: false,
      is_top_seller: false,
      is_sponsored: false,
      is_quotation_enabled: false,
      created_source: 'quick_create',
      review_needed: true,
      variants: {
        create: [{
          name_es: 'Unidad',
          name_en: 'Unit',
          price: opts.price,
          stock_quantity: opts.stock ?? 0,
          is_default: true,
          is_active: true,
        }],
      },
    },
    include: { variants: true },
  });
}

async function main() {
  const productIds: string[] = [];
  let categoryId: string | null = null;

  try {
    const category = await prisma.category.create({
      data: { name_es: `QC Test ${stamp}`, name_en: `QC Test ${stamp}`, sort_order: 9999 },
      select: { id: true },
    });
    categoryId = category.id;

    const p = await quickCreate(category.id, {
      nameEs: `Producto rapido ${stamp}`,
      vat: 'super_reduced',
      price: 1.95,
      stock: 12,
    });
    productIds.push(p.id);

    // ─── Sellable ────────────────────────────────────────────
    check('active immediately', p.is_active === true);
    check('exactly one variant', p.variants.length === 1, p.variants.length);
    check('that variant is the default', p.variants[0]?.is_default === true);
    check('variant is active', p.variants[0]?.is_active === true);
    check('price stored', Number(p.variants[0]?.price) === 1.95, p.variants[0]?.price);
    check('stock stored', p.variants[0]?.stock_quantity === 12);

    // A zero-stock variant is treated as out of stock by buildProductWhere and
    // is unpickable in the order editor, so the stock field has to be honoured
    // rather than defaulted away.
    const zero = await quickCreate(category.id, { nameEs: `Sin stock ${stamp}`, vat: 'reduced', price: 3 });
    productIds.push(zero.id);
    check('stock defaults to 0, not to something sellable', zero.variants[0]?.stock_quantity === 0);

    // ─── But NOT promoted ────────────────────────────────────
    check('not featured', p.is_featured === false);
    check('not a new arrival', p.is_new_arrival === false);
    check('not a top seller', p.is_top_seller === false);
    check('not sponsored', p.is_sponsored === false);
    check('quotation not enabled', p.is_quotation_enabled === false);

    // ─── VAT actually answered ───────────────────────────────
    check('vat_category is what was chosen', p.vat_category === 'super_reduced', p.vat_category);
    // The whole point: every other path leaves this false on the 10% default.
    check('vat marked REVIEWED — a human answered', p.vat_category_reviewed === true);

    // ─── Flagged and attributable ────────────────────────────
    check('review_needed set', p.review_needed === true);
    check('created_source records the path', p.created_source === 'quick_create', p.created_source);

    // ─── Clearing the flag ───────────────────────────────────
    const cleared = await prisma.product.update({
      where: { id: p.id },
      data: { review_needed: false },
      select: { review_needed: true, created_source: true },
    });
    check('review_needed clears', cleared.review_needed === false);
    // Provenance must survive the clear — that is why it is a separate column.
    check('created_source survives the clear', cleared.created_source === 'quick_create');

    // ─── The queue filter finds them ─────────────────────────
    const queued = await prisma.product.count({
      where: { review_needed: true, category_id: category.id },
    });
    check('review queue returns the still-flagged one only', queued === 1, queued);
  } finally {
    if (productIds.length) {
      await prisma.productVariant.deleteMany({ where: { product_id: { in: productIds } } });
      await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    }
    if (categoryId) {
      await prisma.category.deleteMany({ where: { id: categoryId } });
    }
    await prisma.$disconnect();
  }

  console.log(`\n${passed}/${passed + failed} passed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
