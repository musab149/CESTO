// ─── Integration tests · store-scoped taxonomy drill-down ─────────────────
//
// The storefront category → subcategory → product-type pills on
// GET /api/stores/:slug used to be fed by the GLOBAL
// GET /api/categories/:id/subcategories and GET /api/product-types, which
// list every subcategory / product type in the catalogue regardless of
// whether the store carries any products in them — so a shopper could tap a
// pill and land on an empty grid.
//
// The fix adds store-scoped rollups:
//   GET /api/stores/:slug/subcategories?categoryId=…
//   GET /api/stores/:slug/product-types?subcategoryId=…
// Each groups the store's own active products, so only real drill-downs
// appear. Mirrors the category_counts / brand_counts pattern on GET /:slug.
//
// Run:  cd packages/api && npm run test:store-taxonomy

import http from 'http';
import app from '../server';
import prisma from '../lib/prisma';

let base = '';
let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { passed++; console.log(`  PASS  ${name}`); }
  else {
    failed++;
    console.log(`  FAIL  ${name}`);
    if (detail !== undefined) console.log(`        ${JSON.stringify(detail)}`);
  }
}

async function get(path: string) {
  const res = await fetch(`${base}${path}`);
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body };
}

async function main() {
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;

  const stamp = Date.now();
  const slug = `taxtest-store-${stamp}`;
  let storeId = '';
  let catId = '';
  const subIds: string[] = [];
  const typeIds: string[] = [];
  const productIds: string[] = [];

  try {
    const category = await prisma.category.create({
      data: { name_es: `Taxonomía ${stamp}`, name_en: `Taxonomy ${stamp}` },
      select: { id: true },
    });
    catId = category.id;

    const mkSub = async (label: string) => {
      const s = await prisma.subCategory.create({
        data: { category_id: catId, name_es: `Sub ${label} ${stamp}`, name_en: `Sub ${label} ${stamp}` },
        select: { id: true },
      });
      subIds.push(s.id);
      return s.id;
    };
    const subA = await mkSub('A');       // store carries products here
    const subB = await mkSub('B');       // store carries products here
    const subGhost = await mkSub('Ghost'); // exists in the category, store has NOTHING here

    const mkType = async (label: string, subcategoryId: string) => {
      const t = await prisma.productType.create({
        data: { subcategory_id: subcategoryId, name_es: `Type ${label} ${stamp}`, name_en: `Type ${label} ${stamp}` },
        select: { id: true },
      });
      typeIds.push(t.id);
      return t.id;
    };
    const typeA1 = await mkType('A1', subA);      // store carries products
    const typeA2 = await mkType('A2', subA);      // store carries products
    const typeGhost = await mkType('AGhost', subA); // store has NOTHING here

    const store = await prisma.store.create({
      data: { name: `TaxTest Store ${stamp}`, slug, status: 'live', is_active: true, country: 'ES' },
      select: { id: true },
    });
    storeId = store.id;

    const mkProduct = async (
      label: string,
      over: Record<string, unknown>,
    ) => {
      const p = await prisma.product.create({
        data: {
          name_es: `Producto ${label} ${stamp}`,
          name_en: `Product ${label} ${stamp}`,
          category_id: catId,
          store_id: storeId,
          is_active: true,
          ...over,
        },
        select: { id: true },
      });
      productIds.push(p.id);
      return p.id;
    };

    await mkProduct('A1a', { subcategory_id: subA, product_type_id: typeA1 });
    await mkProduct('A1b', { subcategory_id: subA, product_type_id: typeA1 });
    await mkProduct('A2',  { subcategory_id: subA, product_type_id: typeA2 });
    await mkProduct('Bx',  { subcategory_id: subB });
    await mkProduct('A1inactive', { subcategory_id: subA, product_type_id: typeA1, is_active: false });
    await mkProduct('NoSub', {}); // product directly under the category, no subcategory

    // ── store-scoped subcategories ──────────────────────
    console.log('\nGET /api/stores/:slug/subcategories?categoryId=');
    {
      const r = await get(`/api/stores/${slug}/subcategories?categoryId=${catId}`);
      const ids = (r.body?.data ?? []).map((s: any) => s.id).sort();
      check('returns only subcategories the store carries (A + B, not Ghost)',
        JSON.stringify(ids) === JSON.stringify([subA, subB].sort()), ids);
      const rowA = (r.body?.data ?? []).find((s: any) => s.id === subA);
      check('subcategory count excludes the inactive product (A = 3)', rowA?.count === 3, rowA);
    }
    {
      const r = await get(`/api/stores/${slug}/subcategories`);
      check('no categoryId → empty list', Array.isArray(r.body?.data) && r.body.data.length === 0, r.body?.data);
    }

    // ── store-scoped product types ─────────────────────
    console.log('\nGET /api/stores/:slug/product-types?subcategoryId=');
    {
      const r = await get(`/api/stores/${slug}/product-types?subcategoryId=${subA}`);
      const ids = (r.body?.data ?? []).map((t: any) => t.id).sort();
      check('returns only product types the store carries (A1 + A2, not AGhost)',
        JSON.stringify(ids) === JSON.stringify([typeA1, typeA2].sort()), ids);
      const rowA1 = (r.body?.data ?? []).find((t: any) => t.id === typeA1);
      check('product-type count excludes the inactive product (A1 = 2)', rowA1?.count === 2, rowA1);
    }
    {
      const r = await get(`/api/stores/${slug}/product-types?subcategoryId=${subB}`);
      check('subcategory with no typed products → empty list',
        Array.isArray(r.body?.data) && r.body.data.length === 0, r.body?.data);
    }

    // ── contrast: the global endpoint still lists the ghost ─
    console.log('\nContrast — global endpoint is NOT store-scoped');
    {
      const r = await get(`/api/categories/${catId}/subcategories`);
      const ids = (r.body?.data ?? []).map((s: any) => s.id);
      check('global /api/categories/:id/subcategories still includes the ghost subcategory',
        ids.includes(subGhost), ids);
    }
  } finally {
    if (productIds.length) await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    if (typeIds.length) await prisma.productType.deleteMany({ where: { id: { in: typeIds } } });
    if (subIds.length) await prisma.subCategory.deleteMany({ where: { id: { in: subIds } } });
    if (storeId) await prisma.store.deleteMany({ where: { id: storeId } });
    if (catId) await prisma.category.deleteMany({ where: { id: catId } });
    await new Promise<void>((r) => server.close(() => r()));
    await prisma.$disconnect();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
