// ─── Dev utility · fill the category dropdown so its scrolling is testable ───
//
// WHY THIS EXISTS
//
// The tier-2 category dropdown now has a fixed 240px body with each column
// scrolling under its own heading. A seeded database has only a handful of
// subcategories per category and a couple of brands, so nothing overflows and
// the fix is unobservable — the panel looks identical whether the scroll works
// or not.
//
// This gives two categories enough depth to overflow both columns:
//
//   · N subcategories        → the left column scrolls
//   · N products, one brand  → the right column scrolls, because the dropdown
//     each                     derives brands from products in the category
//
// A third category is deliberately LEFT ALONE as a control, so you can hover
// between a full panel and a sparse one and confirm both are the same height.
//
// SAFETY
//
//   · Touches ONLY subcategories, products and product_variants.
//     No orders, users, stores, zones or categories are created or modified.
//   · Everything it writes is prefixed 'QA · ' so it is obvious in the UI and
//     removable in one pass. Nothing pre-existing is renamed or deleted.
//   · Idempotent: re-running converges on the same state.
//   · REFUSES TO RUN against a URL containing 'prod'.
//
// USAGE
//
//   cd packages/api
//   node scripts/seed-dropdown-test-data.mjs            # apply defaults
//   node scripts/seed-dropdown-test-data.mjs --dry      # preview, no writes
//   node scripts/seed-dropdown-test-data.mjs --undo     # remove every QA row
//   node scripts/seed-dropdown-test-data.mjs --count=40 # deeper lists
//   node scripts/seed-dropdown-test-data.mjs --categories=3
//
// DATABASE_URL comes from packages/api/.env unless you set it yourself.

import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config();

const argv = process.argv.slice(2);
const DRY  = argv.includes('--dry');
const UNDO = argv.includes('--undo');
const numArg = (flag, fallback) => {
  const hit = argv.find((a) => a.startsWith(`${flag}=`));
  if (!hit) return fallback;
  const n = Number.parseInt(hit.split('=')[1], 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const COUNT      = numArg('--count', 26);
const CATEGORIES = numArg('--categories', 2);

// The marker is what makes --undo safe: it is the only thing the delete
// matches on, so nothing seeded by prisma/seed.ts can be caught by accident.
const MARK = 'QA · ';

// Real-ish names beat Item 01..26 — they exercise the truncate class on long
// labels, which fixed-width Item NN never would.
const SUB_NAMES = [
  ['Arroz basmati', 'Basmati rice'],
  ['Lentejas rojas', 'Red lentils'],
  ['Garbanzos secos', 'Dried chickpeas'],
  ['Harina de trigo integral', 'Wholewheat flour'],
  ['Especias molidas', 'Ground spices'],
  ['Especias enteras', 'Whole spices'],
  ['Mezclas masala', 'Masala blends'],
  ['Aceite de mostaza', 'Mustard oil'],
  ['Ghee y mantequilla clarificada', 'Ghee and clarified butter'],
  ['Encurtidos y achar', 'Pickles and achar'],
  ['Chutneys', 'Chutneys'],
  ['Pasta de curry', 'Curry paste'],
  ['Fideos y sémola', 'Noodles and semolina'],
  ['Panes congelados', 'Frozen breads'],
  ['Parathas y rotis', 'Parathas and rotis'],
  ['Snacks salados', 'Savoury snacks'],
  ['Dulces tradicionales', 'Traditional sweets'],
  ['Té y chai', 'Tea and chai'],
  ['Bebidas de mango', 'Mango drinks'],
  ['Leche en polvo', 'Powdered milk'],
  ['Frutos secos y nueces', 'Nuts and dried fruit'],
  ['Verduras congeladas', 'Frozen vegetables'],
  ['Pescado congelado', 'Frozen fish'],
  ['Carne halal', 'Halal meat'],
  ['Legumbres en conserva', 'Canned pulses'],
  ['Salsas picantes', 'Hot sauces'],
  ['Arroz sella y parboiled', 'Sella and parboiled rice'],
  ['Papadums', 'Papadums'],
  ['Ingredientes para postres', 'Dessert ingredients'],
  ['Utensilios de cocina', 'Kitchenware'],
];

const BRAND_NAMES = [
  'Shan', 'National', 'Laziza', 'Ahmed', 'Mitchell’s', 'Tapal', 'Vital',
  'Dawn', 'K&N’s', 'Bake Parlor', 'Rafhan', 'Kolson', 'Youngs', 'Habib',
  'Sufi', 'Olpers', 'Nurpur', 'Haleeb', 'Gourmet', 'Peek Freans', 'Hilal',
  'Bisconni', 'Candyland', 'Tullo', 'Soya Supreme', 'Eva', 'Meezan',
  'Kausar', 'Chaman', 'Shezan',
];

const url = process.env.DATABASE_URL ?? '';
if (!url) {
  console.error('DATABASE_URL is not set and packages/api/.env did not supply one. Refusing to guess.');
  process.exit(1);
}
if (/prod/i.test(url)) {
  console.error('DATABASE_URL looks like production. This script seeds TEST data — refusing.');
  process.exit(1);
}

const prisma = new PrismaClient();

async function undo() {
  const products = await prisma.product.findMany({
    where: { name_es: { startsWith: MARK } },
    select: { id: true },
  });
  const subs = await prisma.subCategory.findMany({
    where: { name_es: { startsWith: MARK } },
    select: { id: true },
  });

  console.log(`found ${products.length} QA products and ${subs.length} QA subcategories`);
  if (DRY) { console.log('\n· DRY RUN — nothing deleted ·'); return; }

  // Variants cascade with the product. Products go first so the subcategory
  // delete does not have to null out their subcategory_id on the way past.
  const delProducts = await prisma.product.deleteMany({ where: { name_es: { startsWith: MARK } } });
  const delSubs     = await prisma.subCategory.deleteMany({ where: { name_es: { startsWith: MARK } } });
  console.log(`deleted ${delProducts.count} products, ${delSubs.count} subcategories`);
}

async function apply() {
  const cats = await prisma.category.findMany({
    where: { is_active: true },
    orderBy: { sort_order: 'asc' },
    select: { id: true, name_es: true, name_en: true },
  });

  if (cats.length === 0) {
    console.error('No active categories found. Run `npm run seed` in packages/api first.');
    process.exitCode = 1;
    return;
  }

  const targets = cats.slice(0, CATEGORIES);
  const control = cats[CATEGORIES];

  console.log(`${DRY ? '· DRY RUN — no writes ·' : '· applying ·'}\n`);
  console.log(`filling ${targets.length} categor${targets.length === 1 ? 'y' : 'ies'} with ${COUNT} subcategories + ${COUNT} branded products each`);
  if (control) console.log(`leaving "${control.name_es}" untouched as the sparse control\n`);
  else console.log('');

  for (const cat of targets) {
    let subsMade = 0;
    let prodsMade = 0;
    const subIds = [];

    for (let i = 0; i < COUNT; i++) {
      const [es, en] = SUB_NAMES[i % SUB_NAMES.length];
      // Suffix past the first lap so names stay unique at --count > 30.
      const lap = Math.floor(i / SUB_NAMES.length);
      const nameEs = `${MARK}${es}${lap ? ` ${lap + 1}` : ''}`;
      const nameEn = `${MARK}${en}${lap ? ` ${lap + 1}` : ''}`;

      const existing = await prisma.subCategory.findFirst({
        where: { category_id: cat.id, name_es: nameEs },
        select: { id: true },
      });
      if (existing) { subIds.push(existing.id); continue; }

      if (DRY) { subsMade++; continue; }
      const made = await prisma.subCategory.create({
        data: {
          category_id: cat.id,
          name_es: nameEs,
          name_en: nameEn,
          // Parked after real subcategories so the genuine ones stay on top.
          sort_order: 900 + i,
          is_active: true,
        },
        select: { id: true },
      });
      subIds.push(made.id);
      subsMade++;
    }

    for (let i = 0; i < COUNT; i++) {
      const brand = `${BRAND_NAMES[i % BRAND_NAMES.length]}${Math.floor(i / BRAND_NAMES.length) ? ` ${Math.floor(i / BRAND_NAMES.length) + 1}` : ''}`;
      const nameEs = `${MARK}${brand} — producto de prueba`;
      const nameEn = `${MARK}${brand} — test product`;

      const existing = await prisma.product.findFirst({
        where: { category_id: cat.id, name_es: nameEs },
        select: { id: true },
      });
      if (existing) continue;

      if (DRY) { prodsMade++; continue; }
      await prisma.product.create({
        data: {
          name_es: nameEs,
          name_en: nameEn,
          // Legacy denormalised string only — deliberately no brand_id. The
          // dropdown reads product.brand, and minting Brand rows would put QA
          // names into the admin brand pickers and the Top Brands editor.
          brand,
          category_id: cat.id,
          subcategory_id: subIds[i % Math.max(subIds.length, 1)] ?? null,
          is_active: true,
          variants: {
            create: {
              name_es: 'Unidad',
              name_en: 'Unit',
              price: 2.5,
              stock_quantity: 25,
              is_default: true,
              is_active: true,
            },
          },
        },
      });
      prodsMade++;
    }

    const verb = DRY ? 'would add' : 'added';
    console.log(`  ${cat.name_es}: ${verb} ${subsMade} subcategories, ${prodsMade} products`);
  }

  if (!DRY) {
    console.log('\nHover a filled category in the tier-2 bar. Both columns should');
    console.log('scroll inside a 240px body, and the panel should be the same');
    console.log(`height as "${control?.name_es ?? 'a sparse category'}".`);
    console.log('\nRemove it all with: node scripts/seed-dropdown-test-data.mjs --undo');
  }
}

(UNDO ? undo() : apply())
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
