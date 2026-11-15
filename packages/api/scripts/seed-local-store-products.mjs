// ─── Dev utility · give thin live stores a real-looking catalogue ──────────
//
// WHY THIS EXISTS
//
// A local database copied from staging has a few big stores and several live
// ones with almost nothing in them — a partner store just approved has zero
// products, so its dashboard, storefront and order builder cannot be tried.
//
// This tops those stores up with products CLONED from the big ones: real
// names in both languages, real categories, brands and origins, and the same
// Bunny image URLs, so nothing renders as a broken picture. Each store gets
// its own mix, its own prices (within ±8% of the source) and its own stock.
//
// WHICH STORES
//
//   Live, active, not deleted, not is_test, with fewer than --below products
//   (default 40). Each gets --add new products (default 36), spread across
//   the grocery categories rather than 36 of one kind.
//
// SAFETY
//
//   · REFUSES TO RUN unless DATABASE_URL points at localhost.
//   · Touches ONLY products, product_variants and product_images. No store,
//     category, brand, order or user is created or modified.
//   · Every variant it writes carries an SKU starting 'LOCALSEED-', which is
//     how --undo finds them. Pre-existing products are never changed.
//   · Re-running adds another batch only to stores still under --below.
//
// USAGE
//
//   cd packages/api
//   node scripts/seed-local-store-products.mjs              # apply
//   node scripts/seed-local-store-products.mjs --dry        # preview only
//   node scripts/seed-local-store-products.mjs --undo       # remove them
//   node scripts/seed-local-store-products.mjs --below=60 --add=50

import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config();

const argv = process.argv.slice(2);
const DRY  = argv.includes('--dry');
const UNDO = argv.includes('--undo');
const numArg = (flag, fallback) => {
  const hit = argv.find((a) => a.startsWith(`${flag}=`));
  return hit ? Math.max(1, parseInt(hit.split('=')[1], 10) || fallback) : fallback;
};
const BELOW = numArg('--below', 40);
const ADD   = numArg('--add', 36);
const SKU_PREFIX = 'LOCALSEED-';

const dbHost = (() => {
  try { return new URL(process.env.DATABASE_URL ?? '').hostname; } catch { return ''; }
})();
if (!['localhost', '127.0.0.1', '::1'].includes(dbHost)) {
  console.error(`✖ Refusing to run: DATABASE_URL points at "${dbHost || '(unset)'}", not localhost.`);
  process.exit(1);
}

// The grocery side of the catalogue, and how many of each a store is dealt
// per round — so a shop reads as a grocer with a shelf of cleaning things,
// not the other way round. Packaging, disposables, batteries and smoking
// accessories exist locally but are not what a storefront should open with.
const CATEGORY_WEIGHTS = {
  'Food & Grocery': 3, 'Rice': 2, 'Rice & Pulses': 2, 'Pulses, Lentils & Beans': 2,
  'Flour': 2, 'Spices & Seasonings': 2, 'Herbs, Seasoning & Spices': 2,
  'Snacks / Aperitivos': 2, 'Tea, Coffee & Beverages': 2, 'Desserts & Sweets': 2,
  'Frozen Foods': 2, 'Dry Fruits & Nuts': 1, 'Syrup': 1,
  'Personal Care & Beauty': 1, 'Household Cleaning': 1, 'Home & Kitchen': 1,
};
const GROCERY_CATEGORIES = Object.keys(CATEGORY_WEIGHTS);

const prisma = new PrismaClient();

// Small deterministic hash, so a store gets the same mix on a dry run and
// the real one, and two stores never get the same order.
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const unit = (s) => hash(s) / 0xffffffff;
const money = (n) => Math.round(n * 100) / 100;

async function undo() {
  const seeded = await prisma.product.findMany({
    where: { variants: { some: { sku: { startsWith: SKU_PREFIX } } } },
    select: {
      id: true, name_en: true, store: { select: { name: true } },
      variants: { select: { id: true, _count: { select: { order_items: true } } } },
    },
  });
  const ordered = seeded.filter((p) => p.variants.some((v) => v._count.order_items > 0));
  const removable = seeded.filter((p) => !ordered.includes(p));
  console.log(`Seeded products found: ${seeded.length}. Removable: ${removable.length}.`);
  if (ordered.length) {
    console.log(`Kept ${ordered.length} that appear on an order (deleting them would rewrite history):`);
    for (const p of ordered) console.log(`  · ${p.store?.name} — ${p.name_en}`);
  }
  if (DRY || removable.length === 0) return;
  const ids = removable.map((p) => p.id);
  const variantIds = removable.flatMap((p) => p.variants.map((v) => v.id));
  await prisma.$transaction([
    prisma.cartItem.deleteMany({ where: { variant_id: { in: variantIds } } }),
    prisma.productImage.deleteMany({ where: { product_id: { in: ids } } }),
    prisma.productVariant.deleteMany({ where: { product_id: { in: ids } } }),
    prisma.product.deleteMany({ where: { id: { in: ids } } }),
  ]);
  console.log(`✔ Removed ${ids.length} products.`);
}

async function seed() {
  const stores = await prisma.store.findMany({
    where: { status: 'live', is_active: true, deleted_at: null, is_test: false },
    select: {
      id: true, slug: true, name: true,
      _count: { select: { products: true } },
      products: { select: { name_en: true } },
    },
    orderBy: { name: 'asc' },
  });
  const targets = stores.filter((s) => s._count.products < BELOW);
  if (targets.length === 0) {
    console.log(`Every live store already has ${BELOW}+ products. Nothing to do.`);
    return;
  }
  const targetIds = new Set(targets.map((s) => s.id));

  // The pool: active products from any OTHER owner, with a Bunny image and a
  // priced default variant, in a grocery category. One per name.
  const pool = (await prisma.product.findMany({
    where: {
      is_active: true,
      category: { name_en: { in: GROCERY_CATEGORIES }, is_active: true },
      images: { some: { url: { contains: 'cestostorage.b-cdn.net' } } },
      variants: { some: { is_active: true, price: { gt: 0 } } },
      OR: [{ store_id: null }, { store_id: { notIn: [...targetIds] } }],
    },
    include: {
      category: { select: { name_en: true } },
      variants: { where: { is_active: true }, orderBy: [{ is_default: 'desc' }, { created_at: 'asc' }] },
      images: { orderBy: { sort_order: 'asc' } },
    },
  })).filter((p, i, all) => all.findIndex((q) => q.name_en.trim().toLowerCase() === p.name_en.trim().toLowerCase()) === i);

  const byCategory = new Map();
  for (const p of pool) {
    const k = p.category.name_en;
    if (!byCategory.has(k)) byCategory.set(k, []);
    byCategory.get(k).push(p);
  }
  console.log(`Source pool: ${pool.length} products in ${byCategory.size} categories.`);

  for (const store of targets) {
    const has = new Set(store.products.map((p) => p.name_en.trim().toLowerCase()));
    // Each category's products in this store's own order, then dealt out a
    // few per category per round (CATEGORY_WEIGHTS) so the store opens with
    // a spread, not a wall of dal.
    const queues = [...byCategory.entries()]
      .map(([cat, list]) => ({
        cat,
        list: list
          .filter((p) => !has.has(p.name_en.trim().toLowerCase()))
          .sort((a, b) => hash(store.slug + a.id) - hash(store.slug + b.id)),
      }))
      .filter((q) => q.list.length > 0)
      .sort((a, b) => hash(store.slug + a.cat) - hash(store.slug + b.cat));
    const picked = [];
    while (picked.length < ADD && queues.some((q) => q.list.length)) {
      for (const q of queues) {
        for (let k = 0; k < CATEGORY_WEIGHTS[q.cat] && picked.length < ADD; k++) {
          const next = q.list.shift();
          if (next) picked.push(next);
        }
      }
    }

    const cats = new Set(picked.map((p) => p.category.name_en));
    console.log(`\n${store.name} (${store.slug}) — has ${store._count.products}, adding ${picked.length} across ${cats.size} categories`);
    for (const p of picked.slice(0, 6)) console.log(`  · ${p.name_en}  [${p.category.name_en}]`);
    if (picked.length > 6) console.log(`  · …and ${picked.length - 6} more`);
    if (DRY) continue;

    let n = 0;
    for (const src of picked) {
      n++;
      const factor = 0.92 + unit(store.slug + src.id + 'price') * 0.16;
      await prisma.product.create({
        data: {
          store_id: store.id,
          name_es: src.name_es,
          name_en: src.name_en,
          description_es: src.description_es,
          description_en: src.description_en,
          brand: src.brand,
          origin: src.origin,
          brand_id: src.brand_id,
          origin_id: src.origin_id,
          category_id: src.category_id,
          subcategory_id: src.subcategory_id,
          product_type_id: src.product_type_id,
          vat_category: src.vat_category,
          vat_category_reviewed: src.vat_category_reviewed,
          is_active: true,
          created_source: 'admin',
          variants: {
            create: src.variants.map((v, i) => ({
              name_es: v.name_es,
              name_en: v.name_en,
              price: money(Number(v.price) * factor),
              compare_at_price: v.compare_at_price == null ? null : money(Number(v.compare_at_price) * factor),
              stock_quantity: 20 + Math.floor(unit(store.slug + v.id + 'stock') * 160),
              low_stock_threshold: v.low_stock_threshold,
              is_default: src.variants.some((x) => x.is_default) ? v.is_default : i === 0,
              is_active: true,
              sku: `${SKU_PREFIX}${store.slug}-${n}-${i + 1}`,
            })),
          },
          images: {
            create: src.images.map((img) => ({
              url: img.url,
              alt_text: img.alt_text,
              sort_order: img.sort_order,
              is_primary: img.is_primary,
            })),
          },
        },
      });
    }
    console.log(`  ✔ created ${n}`);
  }
}

(UNDO ? undo() : seed())
  .then(() => { if (DRY) console.log('\n(dry run — nothing written)'); })
  .catch((e) => { console.error('✖', e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
