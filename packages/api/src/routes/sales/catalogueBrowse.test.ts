// ─── Integration test · the Catálogo's browse cards ─────────────────────
//
// Run:  cd packages/api && npm run test:rep-browse
//
// 2026-10-28, the user: "change the catalogue to something like this for
// reps... If they select store then the store cards will show and then they
// select the store and then they go to that one... Similarly if they select
// the category... Similarly for origin and brands".
//
// What has to hold (routes/sales/catalogue.ts):
//   · the shop list carries what a shop card shows — its banner, its line,
//     today's hours — and how many ACTIVE products the rep finds behind it;
//   · brands and origins carry the same count: active, in the rep's shops,
//     plus what is assigned to them by hand, never another shop's;
//   · the list behind each card holds exactly those products.
//
// Makes its own shops, brands, origin, products and rep, and deletes them afterwards.
import http from 'http';
import app from '../../server';
import prisma from '../../lib/prisma';
import { generateAccessToken, generateAdminAccessToken } from '../../lib/jwt';

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { passed++; console.log(`  PASS  ${name}`); }
  else {
    failed++; console.log(`  FAIL  ${name}`);
    if (detail !== undefined) console.log(`        ${JSON.stringify(detail)}`);
  }
}

const stamp = String(Date.now()).slice(-6);
const HOURS = {
  mon: { closed: false, open: '09:00', close: '20:00' }, tue: { closed: false, open: '09:00', close: '20:00' },
  wed: { closed: false, open: '09:00', close: '20:00' }, thu: { closed: false, open: '09:00', close: '20:00' },
  fri: { closed: false, open: '09:00', close: '20:00' }, sat: { closed: false, open: '10:00', close: '14:00' },
  sun: { closed: true },
};

async function main() {
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

  const storeIds: string[] = [];
  const productIds: string[] = [];
  const userIds: string[] = [];
  const brandIds: string[] = [];
  const originIds: string[] = [];

  const call = async (path: string, init: { method?: string; body?: unknown; token?: string } = {}) => {
    const res = await fetch(`${base}${path}`, {
      method: init.method ?? 'GET',
      headers: { 'Content-Type': 'application/json', ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: res.status, body: await res.json().catch(() => null) as { success: boolean; error?: string; data?: any } };
  };

  try {
    // ─── Fixtures ────────────────────────────────────────────
    const category = await prisma.category.findFirst({ where: { is_active: true, approval_status: 'approved' }, select: { id: true } });
    const admin = await prisma.admin.findFirst({ where: { role: 'super_admin' }, select: { id: true, email: true, role: true } });
    if (!category || !admin) { console.log('  SKIP  need an approved category and a super admin'); return; }
    const adminToken = generateAdminAccessToken({ adminId: admin.id, email: admin.email, role: admin.role });

    const X = await prisma.store.create({
      data: {
        name: `QA Browse Shop X ${stamp}`, slug: `qa-browse-x-${stamp}`, status: 'live', is_active: true,
        cover_url: 'https://example.test/cover-x.webp', tagline_es: 'Todo para tu tienda', tagline_en: 'All for your shop', shop_hours: HOURS,
      },
      select: { id: true },
    });
    const Y = await prisma.store.create({ data: { name: `QA Browse Shop Y ${stamp}`, slug: `qa-browse-y-${stamp}`, status: 'live', is_active: true }, select: { id: true } });
    storeIds.push(X.id, Y.id);
    const B1 = await prisma.brand.create({ data: { name: `QA Browse Brand One ${stamp}`, slug: `qa-browse-b1-${stamp}`, is_active: true }, select: { id: true } });
    const B2 = await prisma.brand.create({ data: { name: `QA Browse Brand Two ${stamp}`, slug: `qa-browse-b2-${stamp}`, is_active: true }, select: { id: true } });
    const BY = await prisma.brand.create({ data: { name: `QA Browse Brand Y ${stamp}`, slug: `qa-browse-by-${stamp}`, is_active: true }, select: { id: true } });
    brandIds.push(B1.id, B2.id, BY.id);
    const O1 = await prisma.origin.create({ data: { key: `qa-browse-${stamp}`, label_es: `QA Origen ${stamp}`, label_en: `QA Origin ${stamp}`, is_active: true }, select: { id: true } });
    originIds.push(O1.id);

    const mkProduct = async (storeId: string, label: string, opts: { brand?: string; origin?: string; active?: boolean } = {}) => {
      const p = await prisma.product.create({
        data: {
          name_es: `QA Browse ${label} ${stamp}`, name_en: `QA Browse ${label} ${stamp}`, category_id: category.id, store_id: storeId,
          is_active: opts.active ?? true, brand_id: opts.brand ?? null, origin_id: opts.origin ?? null,
          variants: { create: [{ name_es: 'Unidad', name_en: 'Unit', price: 4, stock_quantity: 20, is_default: true }] },
        },
        select: { id: true },
      });
      productIds.push(p.id);
      return p.id;
    };
    const x1 = await mkProduct(X.id, 'X1', { brand: B1.id, origin: O1.id });
    const x2 = await mkProduct(X.id, 'X2', { brand: B1.id, origin: O1.id });
    await mkProduct(X.id, 'X3-inactive', { brand: B1.id, origin: O1.id, active: false });
    const x4 = await mkProduct(X.id, 'X4', { brand: B2.id });
    const y1 = await mkProduct(Y.id, 'Y1', { brand: B1.id, origin: O1.id });
    await mkProduct(Y.id, 'Y2', { brand: BY.id });

    // A rep who sells from shop X.
    const repEmail = `qa.browse.${stamp}@cesto.test`;
    const granted = await call('/api/admin/sales-reps', { method: 'POST', token: adminToken, body: { name: 'QA Browse Rep', email: repEmail, send_credentials: false, store_ids: [X.id] } });
    const repId = granted.body.data?.user_id as string;
    if (repId) userIds.push(repId);
    check('a rep is granted with shop X', granted.status === 201, { status: granted.status, error: granted.body.error });
    const repToken = generateAccessToken({ userId: repId, email: repEmail });

    type Row = { id: string; products?: number; [k: string]: unknown };
    const list = async (what: 'stores' | 'brands' | 'origins'): Promise<Row[]> => {
      const r = await call(`/api/sales/catalogue/${what}`, { token: repToken });
      return (what === 'stores' ? r.body.data?.items : r.body.data) ?? [];
    };
    const productsOf = async (extra: string) =>
      ((await call(`/api/sales/catalogue/products?limit=100&prices=both${extra}`, { token: repToken })).body.data?.items ?? []).map((p: { id: string }) => p.id).sort();
    const same = (a: string[], b: string[]) => a.join() === [...b].sort().join();

    // ─── 1. The shop card ───────────────────────────────────
    const shops = await list('stores');
    const x = shops.find((s) => s.id === X.id);
    check('the shop list holds shop X only', shops.length === 1 && !!x, shops.map((s) => s.id));
    // Day by day: Postgres hands jsonb keys back in its own order.
    const hours = (x?.shop_hours ?? {}) as Record<string, Record<string, unknown>>;
    const sameHours = Object.entries(HOURS).every(([day, want]) =>
      Object.entries(want).every(([k, v]) => hours[day]?.[k] === v) && Object.keys(hours[day] ?? {}).length === Object.keys(want).length);
    check('...with its banner, its line and its hours', x?.cover_url === 'https://example.test/cover-x.webp' && x?.tagline_es === 'Todo para tu tienda' && x?.tagline_en === 'All for your shop'
      && sameHours, x && { cover: x.cover_url, tagline: x.tagline_es, hours: x.shop_hours });
    check('...and the active products behind its card: 3 of its 4', x?.products === 3 && (x?._count as { products: number })?.products === 4, x && { products: x.products, all: x._count });
    check('the list behind the card holds exactly those three', same(await productsOf(`&storeId=${X.id}`), [x1, x2, x4]));
    check('another shop\'s list is empty for this rep', (await productsOf(`&storeId=${Y.id}`)).length === 0);

    // ─── 2. Brands and origins ──────────────────────────────
    const brands = await list('brands');
    const b1 = brands.find((b) => b.id === B1.id);
    const b2 = brands.find((b) => b.id === B2.id);
    check('brand one counts its active products in shop X only: 2', b1?.products === 2, b1);
    check('brand two counts 1', b2?.products === 1, b2);
    check('a brand only shop Y carries is not listed', !brands.some((b) => b.id === BY.id));
    check('the list behind brand one holds X1 and X2', same(await productsOf(`&brandId=${B1.id}`), [x1, x2]));
    const origins = await list('origins');
    const o1 = origins.find((o) => o.id === O1.id);
    check('the origin counts 2 — not the inactive one, not shop Y\'s', o1?.products === 2, o1);
    check('the list behind it holds X1 and X2', same(await productsOf(`&originId=${O1.id}`), [x1, x2]));

    // ─── 3. A product assigned by hand from shop Y ───────────
    const assigned = await call(`/api/admin/sales-reps/${repId}/products`, { method: 'POST', token: adminToken, body: { product_ids: [y1] } });
    check('the office assigns them Y1 by hand', assigned.status === 200 || assigned.status === 201, { status: assigned.status, error: assigned.body.error });
    const b1After = (await list('brands')).find((b) => b.id === B1.id);
    const o1After = (await list('origins')).find((o) => o.id === O1.id);
    check('brand one now counts it: 3', b1After?.products === 3, b1After);
    check('...and the origin: 3', o1After?.products === 3, o1After);
    check('...and its list shows it', same(await productsOf(`&brandId=${B1.id}`), [x1, x2, y1]));
    const shopsAfter = await list('stores');
    check('shop Y does not become one of their shop cards', shopsAfter.length === 1 && shopsAfter[0].id === X.id && shopsAfter[0].products === 3, shopsAfter.map((s) => [s.id, s.products]));
  } finally {
    if (productIds.length) {
      await prisma.productImage.deleteMany({ where: { product_id: { in: productIds } } });
      await prisma.productVariant.deleteMany({ where: { product_id: { in: productIds } } });
      await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    }
    if (userIds.length) {
      await prisma.salesRep.deleteMany({ where: { user_id: { in: userIds } } });
      await prisma.userRefreshToken.deleteMany({ where: { user_id: { in: userIds } } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    if (brandIds.length) await prisma.brand.deleteMany({ where: { id: { in: brandIds } } });
    if (originIds.length) await prisma.origin.deleteMany({ where: { id: { in: originIds } } });
    if (storeIds.length) await prisma.store.deleteMany({ where: { id: { in: storeIds } } });
    await prisma.$disconnect();
    server.close();
  }

  console.log(`\n${passed}/${passed + failed} passed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
