// ─── Integration tests · store-scoped brand rollup + brand filter ─────────
//
// GET /api/stores/:slug now returns `brand_counts` — one row per canonical
// Brand the store actually carries, counting only its active products — and
// GET /api/stores/:slug/products accepts `?brandId=` to filter the grid to
// that brand. Both mirror the existing `category_counts` / `categoryId`
// behaviour: inactive products don't count, an inactive Brand drops out, and
// the brand filter ANDs with the category filter rather than replacing it.
//
// Run:  cd packages/api && npm run test:store-brands

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
  const slug = `brandtest-store-${stamp}`;
  let storeId = '';
  let brandId = '';
  let otherCategoryId = '';
  let categoryId = '';
  const productIds: string[] = [];

  try {
    const category = await prisma.category.create({
      data: { name_es: `Marca ${stamp}`, name_en: `Brand ${stamp}` },
      select: { id: true },
    });
    categoryId = category.id;
    const otherCategory = await prisma.category.create({
      data: { name_es: `Otra ${stamp}`, name_en: `Other ${stamp}` },
      select: { id: true },
    });
    otherCategoryId = otherCategory.id;

    const store = await prisma.store.create({
      data: {
        name: `BrandTest Store ${stamp}`,
        slug,
        status: 'live',
        is_active: true,
        country: 'ES',
      },
      select: { id: true },
    });
    storeId = store.id;

    const brand = await prisma.brand.create({
      data: { name: `BrandTest Brand ${stamp}`, slug: `brandtest-brand-${stamp}` },
      select: { id: true },
    });
    brandId = brand.id;

    const mkProduct = async (
      label: string,
      over: Record<string, unknown>,
    ) => {
      const p = await prisma.product.create({
        data: {
          name_es: `Producto ${label} ${stamp}`,
          name_en: `Product ${label} ${stamp}`,
          category_id: categoryId,
          store_id: storeId,
          is_active: true,
          ...over,
        },
        select: { id: true },
      });
      productIds.push(p.id);
      return p.id;
    };

    // 2 active products on the brand, 1 inactive on the brand, 1 active with
    // no canonical brand.
    const active1 = await mkProduct('Active1', { brand_id: brandId, brand: `BrandTest Brand ${stamp}` });
    const active2 = await mkProduct('Active2', { brand_id: brandId, brand: `BrandTest Brand ${stamp}` });
    await mkProduct('Inactive', { brand_id: brandId, is_active: false });
    await mkProduct('NoBrand', {});

    // ── brand_counts on the store detail ────────────────
    console.log('\nGET /api/stores/:slug brand_counts');
    {
      const r = await get(`/api/stores/${slug}`);
      const bc = r.body?.data?.brand_counts ?? [];
      const row = bc.find((b: any) => b.brand_id === brandId);
      check('brand_counts has exactly one row', bc.length === 1, bc);
      check('the row counts only the 2 active branded products', row?.count === 2, row);
      check('the row carries name + slug', row?.slug === `brandtest-brand-${stamp}` && typeof row?.name === 'string', row);
    }

    // ── brandId filter on the product list ──────────────
    console.log('\nGET /api/stores/:slug/products?brandId=');
    {
      const r = await get(`/api/stores/${slug}/products?brandId=${brandId}&limit=50`);
      const ids = (r.body?.data?.products ?? []).map((p: any) => p.id).sort();
      check('returns exactly the 2 active branded products', JSON.stringify(ids) === JSON.stringify([active1, active2].sort()), ids);
      check('total reflects the brand filter', r.body?.data?.total === 2, r.body?.data?.total);
      check('every returned product has the requested brand_id',
        (r.body?.data?.products ?? []).every((p: any) => p.brand_id === brandId));
    }

    // ── brand AND category compose ──────────────────────
    console.log('\nbrandId + categoryId compose (AND, not replace)');
    {
      const r = await get(`/api/stores/${slug}/products?brandId=${brandId}&categoryId=${categoryId}&limit=50`);
      check('brand + matching category still returns the 2 products', r.body?.data?.total === 2, r.body?.data?.total);
    }
    {
      const r = await get(`/api/stores/${slug}/products?brandId=${brandId}&categoryId=${otherCategoryId}&limit=50`);
      check('brand + unrelated category returns nothing', r.body?.data?.total === 0, r.body?.data?.total);
    }

    // ── an inactive Brand drops out of the rollup ───────
    console.log('\nInactive Brand disappears from brand_counts');
    {
      await prisma.brand.update({ where: { id: brandId }, data: { is_active: false } });
      const r = await get(`/api/stores/${slug}`);
      const bc = r.body?.data?.brand_counts ?? [];
      check('brand_counts is empty once the Brand is deactivated', bc.length === 0, bc);
      await prisma.brand.update({ where: { id: brandId }, data: { is_active: true } });
    }
  } finally {
    if (productIds.length) await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    if (brandId) await prisma.brand.deleteMany({ where: { id: brandId } });
    if (storeId) await prisma.store.deleteMany({ where: { id: storeId } });
    if (categoryId) await prisma.category.deleteMany({ where: { id: categoryId } });
    if (otherCategoryId) await prisma.category.deleteMany({ where: { id: otherCategoryId } });
    await new Promise<void>((r) => server.close(() => r()));
    await prisma.$disconnect();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
