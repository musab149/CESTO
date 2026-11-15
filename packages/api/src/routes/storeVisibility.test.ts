// ─── Integration tests · deactivated store's products/packs stay hidden ────
//
// `customerVisibleStoreFilter` used to omit `is_active`, on the theory that
// callers would add it themselves — which works for a direct Store query but
// not when the filter is nested inside a `store: {...}` relation filter
// (`customerStoreVisibleProductFilter`, `visibleRashanPackWhere`). Nobody had
// anywhere to inject `store.is_active` in that shape, so a store deactivated
// via the admin's "Active" toggle (is_active=false, status stays 'live')
// kept its products and rashan packs showing on every general customer
// listing — New products, Sponsored, Popular, All products, category pages,
// search, and /api/rashan/packs — even though the store's own page
// (GET /api/stores/:slug, via isStoreCustomerVisible) already 404'd
// correctly.
//
// This covers the fix: an inactive-but-'live' store's product/pack must
// disappear from every one of those surfaces, while a paused-but-active
// store (the pre-existing, separately-handled case) must keep disappearing
// too — proving the two checks stay independently correct.
//
// Run:  cd packages/api && npm run test:store-visibility

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
  const storeIds: string[] = [];
  const productIds: string[] = [];
  const packIds: string[] = [];
  let categoryId = '';

  try {
    const category = await prisma.category.create({
      data: { name_es: `Visibilidad ${stamp}`, name_en: `Visibility ${stamp}` },
      select: { id: true },
    });
    categoryId = category.id;

    const mkStore = async (label: string, over: Record<string, unknown>) => {
      const st = await prisma.store.create({
        data: {
          name: `VisTest ${label} ${stamp}`,
          slug: `vistest-${label.toLowerCase()}-${stamp}`,
          status: 'live',
          is_active: true,
          country: 'ES',
          ...over,
        },
        select: { id: true },
      });
      storeIds.push(st.id);
      return st.id;
    };

    const mkProduct = async (label: string, storeId: string) => {
      const p = await prisma.product.create({
        data: {
          name_es: `Producto ${label} ${stamp}`,
          name_en: `Product ${label} ${stamp}`,
          category_id: categoryId,
          store_id: storeId,
          is_active: true,
          is_sponsored: true,
          is_featured: true,
          is_new_arrival: true,
        },
        select: { id: true },
      });
      productIds.push(p.id);
      return p.id;
    };

    const mkPack = async (label: string, storeId: string) => {
      const pk = await prisma.rashanPack.create({
        data: {
          slug: `vistest-${label.toLowerCase()}-${stamp}`,
          name_es: `Pack ${label} ${stamp}`,
          name_en: `Pack ${label} ${stamp}`,
          store_id: storeId,
          is_active: true,
        },
        select: { id: true },
      });
      packIds.push(pk.id);
      return pk.id;
    };

    // ── fixtures ─────────────────────────────────────────
    const inactiveStore = await mkStore('Inactive', { is_active: false });
    const inactiveProduct = await mkProduct('FromInactive', inactiveStore);
    const inactivePack = await mkPack('FromInactive', inactiveStore);

    const pausedStore = await mkStore('Paused', { status: 'paused' });
    const pausedProduct = await mkProduct('FromPaused', pausedStore);

    const liveStore = await mkStore('Live', {});
    const liveProduct = await mkProduct('FromLive', liveStore);

    // ── general listings must hide the inactive store's product ─────
    console.log('\nGeneral product listings');
    {
      const r = await get('/api/products?limit=100');
      const ids = (r.body?.data?.items ?? []).map((p: any) => p.id);
      check('/api/products excludes the inactive store\'s product', !ids.includes(inactiveProduct), r.status);
      check('/api/products excludes the paused store\'s product', !ids.includes(pausedProduct));
      check('/api/products still includes the live store\'s product', ids.includes(liveProduct));
    }
    {
      const r = await get('/api/products/sponsored?limit=100');
      const ids = (r.body?.data ?? []).map((p: any) => p.id);
      check('sponsored rail excludes the inactive store\'s product', !ids.includes(inactiveProduct));
      check('sponsored rail still includes the live store\'s product', ids.includes(liveProduct));
    }
    {
      const r = await get('/api/products/featured?limit=100');
      const ids = (r.body?.data ?? []).map((p: any) => p.id);
      check('featured rail excludes the inactive store\'s product', !ids.includes(inactiveProduct));
    }
    {
      const r = await get(`/api/categories/${categoryId}/products?limit=100`);
      const ids = (r.body?.data?.products ?? []).map((p: any) => p.id);
      check('category listing excludes the inactive store\'s product', !ids.includes(inactiveProduct));
      check('category listing still includes the live store\'s product', ids.includes(liveProduct));
    }
    {
      const r = await get(`/api/search?q=${encodeURIComponent(`FromInactive ${stamp}`)}`);
      const ids = (r.body?.data?.products ?? []).map((p: any) => p.id);
      check('search excludes the inactive store\'s product', !ids.includes(inactiveProduct));
    }
    {
      const r = await get(`/api/search?q=${encodeURIComponent(`FromLive ${stamp}`)}`);
      const ids = (r.body?.data?.products ?? []).map((p: any) => p.id);
      check('search still finds the live store\'s product', ids.includes(liveProduct));
    }
    {
      const r = await get(`/api/products/${inactiveProduct}`);
      check('product detail 404s for a product on an inactive store', r.status === 404, r.status);
    }

    // ── rashan packs must hide too ───────────────────────
    console.log('\nRashan packs');
    {
      const r = await get('/api/rashan/packs');
      const ids = (r.body?.data ?? []).map((p: any) => p.id);
      check('/api/rashan/packs excludes the inactive store\'s pack', !ids.includes(inactivePack), r.status);
    }

    // ── the store's own page (unchanged behavior) ────────
    console.log('\nStore pages (should already be correct, unchanged)');
    {
      const r = await get(`/api/stores/vistest-inactive-${stamp}`);
      check('inactive store\'s own page 404s', r.status === 404, r.status);
    }
    {
      const r = await get(`/api/stores/vistest-paused-${stamp}`);
      check('paused store\'s own page soft-200s with is_paused', r.status === 200 && r.body?.data?.is_paused === true, r.body?.data);
    }
    {
      const r = await get(`/api/stores/vistest-live-${stamp}`);
      check('live store\'s own page 200s normally', r.status === 200 && !r.body?.data?.is_paused, r.status);
    }
  } finally {
    if (packIds.length) await prisma.rashanPack.deleteMany({ where: { id: { in: packIds } } });
    if (productIds.length) await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    if (storeIds.length) await prisma.store.deleteMany({ where: { id: { in: storeIds } } });
    if (categoryId) await prisma.category.deleteMany({ where: { id: categoryId } });
    await new Promise<void>((r) => server.close(() => r()));
    await prisma.$disconnect();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
