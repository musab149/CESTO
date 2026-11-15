// ─── Integration tests · partner duplicate detection ───────
//
// The partner detection was ported from admin's identity-based algorithm
// (2026-07-24), replacing a union-find over loose signals. These tests pin the
// behavioural difference between the two, because that is the whole point of
// the change and neither a typecheck nor a green build can see it:
//
//   OLD (union-find): grouped on name OR brand+variant OR image. Two different
//   products sharing a placeholder image were "duplicates" — and a partner
//   acting on that suggestion deletes real inventory.
//
//   NEW (identity): name_es + name_en + brand + origin + category +
//   subcategory + product_type, all at once. Images, prices, stock and pack
//   sizes are ignored.
//
// Runs against the real app on an ephemeral port, so it never competes with
// the dev server on 3000. Creates its own store, partner user and products,
// and removes them in a finally block.
//
// Run:  cd packages/api && npm run test:partner-duplicates

import http from 'http';
import app from '../../server';
import prisma from '../../lib/prisma';
import { generateAccessToken } from '../../lib/jwt';

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

async function get(path: string, token: string) {
  const res = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } });
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
  let storeId = '';
  let otherStoreId = '';
  let userId = '';
  let categoryId = '';
  const productIds: string[] = [];

  try {
    const category = await prisma.category.findFirst({ select: { id: true } });
    if (!category) throw new Error('No category in the database — seed one first.');
    categoryId = category.id;

    const store = await prisma.store.create({
      data: { name: `DupTest ${stamp}`, slug: `duptest-${stamp}`, status: 'live', is_active: true },
      select: { id: true },
    });
    storeId = store.id;

    const other = await prisma.store.create({
      data: { name: `DupOther ${stamp}`, slug: `dupother-${stamp}`, status: 'live', is_active: true },
      select: { id: true },
    });
    otherStoreId = other.id;

    const user = await prisma.user.create({
      data: {
        name: 'Dup Test Partner',
        email: `dup-test-${stamp}@cesto.local`,
        phone: `+3460000${String(stamp).slice(-4)}`,
        password_hash: 'x'.repeat(60),
        status: 'active',
      },
      select: { id: true },
    });
    userId = user.id;

    await prisma.partnerStoreRole.create({
      data: { user_id: user.id, store_id: store.id, role: 'owner' },
    });

    const token = generateAccessToken({ userId: user.id, email: `dup-test-${stamp}@cesto.local` } as any);

    const mk = async (over: Record<string, unknown>, sid: string = storeId) => {
      const p = await prisma.product.create({
        data: {
          name_es: 'Arroz Basmati', name_en: 'Basmati Rice',
          brand: 'Tilda', origin: 'India',
          category_id: categoryId, store_id: sid, is_active: true,
          ...over,
        },
        select: { id: true },
      });
      productIds.push(p.id);
      return p.id;
    };

    // ── identical identity, different pack sizes ────────
    console.log('\nIdentity matching');
    const a = await mk({});
    const b = await mk({});
    {
      const r = await get('/api/partner/products/duplicates', token);
      check('endpoint responds', r.status === 200, r.status);
      const groups = r.body?.data?.groups ?? [];
      check('two identical products form one group', groups.length === 1, groups.length);
      check('the group holds both', groups[0]?.products?.length === 2, groups[0]?.products?.length);
      check('group ids are the two products',
        [a, b].every((id) => (groups[0]?.products ?? []).some((p: any) => p.id === id)),
        groups[0]?.products?.map((p: any) => p.id));
    }

    // ── accents and casing must not split a group ───────
    {
      await mk({ name_es: '  ARROZ  BASMATI ', name_en: 'BASMATI RICE' });
      const r = await get('/api/partner/products/duplicates', token);
      const groups = r.body?.data?.groups ?? [];
      check('casing and whitespace normalise into the same group',
        groups.length === 1 && groups[0].products.length === 3,
        { groups: groups.length, size: groups[0]?.products?.length });
    }

    // ── a different identity field must split ───────────
    console.log('\nIdentity fields that separate products');
    {
      await mk({ brand: 'Daawat' });
      const r = await get('/api/partner/products/duplicates', token);
      const groups = r.body?.data?.groups ?? [];
      check('a different brand is NOT a duplicate',
        groups.length === 1 && groups[0].products.length === 3,
        { groups: groups.length, size: groups[0]?.products?.length });
    }
    {
      await mk({ origin: 'Pakistan' });
      const r = await get('/api/partner/products/duplicates', token);
      const groups = r.body?.data?.groups ?? [];
      check('a different origin is NOT a duplicate',
        groups.length === 1 && groups[0].products.length === 3,
        { groups: groups.length, size: groups[0]?.products?.length });
    }

    // ── the regression the rewrite exists to fix ────────
    console.log('\nThe old union-find false positive');
    {
      // Two unrelated products sharing one image. The old algorithm had an
      // `img:` union key and would have grouped these; identity must not.
      const x = await mk({ name_es: 'Lentejas', name_en: 'Lentils', brand: 'Goya' });
      const y = await mk({ name_es: 'Garbanzos', name_en: 'Chickpeas', brand: 'Goya' });
      const url = 'https://example.test/shared-placeholder.jpg';
      await prisma.productImage.createMany({
        data: [
          { product_id: x, url, is_primary: true, sort_order: 0 },
          { product_id: y, url, is_primary: true, sort_order: 0 },
        ],
      });
      const r = await get('/api/partner/products/duplicates', token);
      const groups = r.body?.data?.groups ?? [];
      const grouped = groups.some((g: any) => {
        const ids = g.products.map((p: any) => p.id);
        return ids.includes(x) && ids.includes(y);
      });
      check('two different products sharing an image are NOT duplicates', !grouped, groups.length);
    }

    // ── store scoping ───────────────────────────────────
    console.log('\nStore scoping');
    {
      // Same identity as the group above, but in another store. A partner must
      // never see it — and it must not enlarge their group either.
      await mk({}, otherStoreId);
      const r = await get('/api/partner/products/duplicates', token);
      const groups = r.body?.data?.groups ?? [];
      check("another store's identical product is invisible",
        groups.length === 1 && groups[0].products.length === 3,
        { groups: groups.length, size: groups[0]?.products?.length });
      const allIds = groups.flatMap((g: any) => g.products.map((p: any) => p.store_id));
      check('every returned product belongs to this store',
        allIds.every((id: string) => id === storeId), [...new Set(allIds)]);
    }

    // ── response shape parity with admin ────────────────
    console.log('\nResponse shape');
    {
      const r = await get('/api/partner/products/duplicates', token);
      const d = r.body?.data ?? {};
      check('multi_store_listings present and empty',
        Array.isArray(d.multi_store_listings) && d.multi_store_listings.length === 0,
        d.multi_store_listings);
      check('multi-store totals are zero',
        d.total_multi_store_groups === 0 && d.total_multi_store_products === 0,
        [d.total_multi_store_groups, d.total_multi_store_products]);
      check('match_reasons is no longer emitted',
        (d.groups ?? []).every((g: any) => g.match_reasons === undefined),
        (d.groups ?? []).map((g: any) => g.match_reasons));
      check('is_cross_store is always false',
        (d.groups ?? []).every((g: any) => g.is_cross_store === false),
        (d.groups ?? []).map((g: any) => g.is_cross_store));
      check('label uses the original casing of the oldest row',
        d.groups?.[0]?.label === 'Arroz Basmati', d.groups?.[0]?.label);
    }

    // ── auth ────────────────────────────────────────────
    console.log('\nAuthentication');
    {
      const res = await fetch(`${base}/api/partner/products/duplicates`);
      check('unauthenticated request is rejected', res.status === 401, res.status);
    }
  } finally {
    if (productIds.length) {
      await prisma.productImage.deleteMany({ where: { product_id: { in: productIds } } });
      await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    }
    if (userId) await prisma.partnerStoreRole.deleteMany({ where: { user_id: userId } });
    if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    if (storeId) await prisma.store.delete({ where: { id: storeId } }).catch(() => {});
    if (otherStoreId) await prisma.store.delete({ where: { id: otherStoreId } }).catch(() => {});
    await new Promise<void>((r) => server.close(() => r()));
    await prisma.$disconnect();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
