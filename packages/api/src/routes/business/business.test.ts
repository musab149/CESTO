// ─── Integration test · the business panel's API ─────────────────────
//
// Run:  cd packages/api && npm run test:business
//
// 2026-10-29, the user: "When the user signs in as a b2b user then they are
// going to see a dashboard just like the reps… B2B catalog is where all the
// products in our system will show with there b2b price mentioned", and of a
// product with no wholesale price: "Only products with a B2B price".
//
// What has to hold (middleware/businessAuth, routes/business/*):
//   · only an approved business gets in; anyone else is refused, signed out is 401;
//   · the catalogue holds what the shop shows a business AND has a wholesale
//     size — never a retail-only product, a B2C-only one, or one from a shop
//     that is not live — and offers only the wholesale sizes;
//   · each size is priced as checkout charges: wholesale, less any price
//     agreed with this customer — and its retail price never goes out;
//   · every browse card's count is the products behind it;
//   · a business left on `retail` is put back on wholesale before prices go out;
//   · the summary counts a split purchase once and leaves cancelled orders out.
//
// Makes its own shops, brand, origin, products, users and orders, and deletes them afterwards.
import http from 'http';

import app from '../../server';
import prisma from '../../lib/prisma';
import { generateAccessToken } from '../../lib/jwt';

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
const num = (v: unknown) => Number(v);

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

  const call = async (path: string, token?: string) => {
    const res = await fetch(`${base}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: res.status, body: await res.json().catch(() => null) as { success: boolean; error?: string; data?: any } };
  };
  const put = async (path: string, token: string, body: unknown) => {
    const res = await fetch(`${base}${path}`, {
      method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: res.status, body: await res.json().catch(() => null) as { success: boolean; error?: string; data?: any } };
  };

  try {
    const category = await prisma.category.findFirst({ where: { is_active: true, approval_status: 'approved' }, select: { id: true } });
    if (!category) { console.log('  SKIP  need an approved category'); return; }

    // ─── Fixtures ────────────────────────────────────────────
    const live = await prisma.store.create({ data: { name: `QA Biz Shop ${stamp}`, slug: `qa-biz-live-${stamp}`, status: 'live', is_active: true }, select: { id: true } });
    const off = await prisma.store.create({ data: { name: `QA Biz Shop Off ${stamp}`, slug: `qa-biz-off-${stamp}`, status: 'live', is_active: false }, select: { id: true } });
    storeIds.push(live.id, off.id);
    const brand = await prisma.brand.create({ data: { name: `QA Biz Brand ${stamp}`, slug: `qa-biz-brand-${stamp}`, is_active: true }, select: { id: true } });
    brandIds.push(brand.id);
    const origin = await prisma.origin.create({ data: { key: `qa-biz-${stamp}`, label_es: `QA Origen Biz ${stamp}`, label_en: `QA Biz Origin ${stamp}`, is_active: true }, select: { id: true } });
    originIds.push(origin.id);

    type Size = { name: string; price: number; b2b?: number; active?: boolean };
    const mk = async (label: string, storeId: string | null, sizes: Size[], opts: { audience?: 'all' | 'b2c' | 'b2b'; active?: boolean } = {}) => {
      const p = await prisma.product.create({
        data: {
          name_es: `QA Biz ${label} ${stamp}`, name_en: `QA Biz ${label} ${stamp}`, category_id: category.id, store_id: storeId,
          is_active: opts.active ?? true, audience: opts.audience ?? 'all', brand_id: brand.id, origin_id: origin.id,
          variants: {
            create: sizes.map((z, i) => ({
              name_es: z.name, name_en: z.name, price: z.price, b2b_price: z.b2b ?? null,
              is_active: z.active ?? true, stock_quantity: 50, is_default: i === 0,
            })),
          },
        },
        select: { id: true, variants: { select: { id: true, name_es: true } } },
      });
      productIds.push(p.id);
      return p;
    };
    // In: a wholesale size and a retail-only one (only the first is offered).
    const A = await mk('A', live.id, [{ name: 'Caja', price: 10, b2b: 7.5 }, { name: 'Unidad', price: 1.2 }]);
    // Out: no wholesale price at all.
    const B = await mk('B', live.id, [{ name: 'Caja', price: 10 }]);
    // Out: shown to households only.
    await mk('C', live.id, [{ name: 'Caja', price: 10, b2b: 7 }], { audience: 'b2c' });
    // Out: its shop is switched off.
    await mk('D', off.id, [{ name: 'Caja', price: 10, b2b: 7 }]);
    // Out: inactive.
    await mk('E', live.id, [{ name: 'Caja', price: 10, b2b: 7 }], { active: false });
    // Out: its only wholesale size is inactive.
    await mk('F', live.id, [{ name: 'Caja', price: 10, b2b: 7, active: false }, { name: 'Unidad', price: 1 }]);
    // In: business-only, Cesto's own (no store).
    const G = await mk('G', null, [{ name: 'Saco', price: 30, b2b: 24 }], { audience: 'b2b' });

    const biz = await prisma.user.create({
      data: {
        name: `QA Biz Buyer ${stamp}`, email: `qa.biz.${stamp}@cesto.test`, is_business: true, pricing_mode: 'retail',
        business_profile: { create: { company: `QA Biz SL ${stamp}`, registration_no: 'B12345678' } },
        // A price agreed with them: 1 € off a box of A.
        product_discounts: { create: { product_id: A.id, variant_id: A.variants.find((v) => v.name_es === 'Caja')!.id, amount: 1 } },
      },
      select: { id: true, email: true },
    });
    const shopper = await prisma.user.create({ data: { name: `QA Biz Shopper ${stamp}`, email: `qa.shopper.${stamp}@cesto.test` }, select: { id: true, email: true } });
    userIds.push(biz.id, shopper.id);
    const bizToken = generateAccessToken({ userId: biz.id, email: biz.email! });
    const shopperToken = generateAccessToken({ userId: shopper.id, email: shopper.email! });

    // ─── Who gets in ────────────────────────────────────────
    check('signed out is 401', (await call('/api/business/me')).status === 401);
    const refused = await call('/api/business/catalogue/products', shopperToken);
    check('an ordinary customer is refused (403)', refused.status === 403, refused);
    const me0 = await call('/api/business/me', bizToken);
    check('an approved business gets its summary', me0.status === 200, me0.body?.error);
    const healed = await prisma.user.findUnique({ where: { id: biz.id }, select: { pricing_mode: true } });
    check('a business left on retail is put back on wholesale', healed?.pricing_mode === 'b2b', healed);
    check('the summary names the business', me0.body?.data?.business?.company === `QA Biz SL ${stamp}`, me0.body?.data?.business);

    // ─── The home's content (Admin → Business home, 2026-10-31) ──
    // Read only: the row is the team's, and this test runs against a shared database.
    const home = await call('/api/business/home', bizToken);
    check('a business gets its home content', home.status === 200 && typeof home.body?.data?.intro?.title_es === 'string', home.body?.error);
    check('…with only live promotions in it', (home.body?.data?.promotions ?? []).every((p: { is_active: boolean }) => p.is_active), home.body?.data?.promotions);
    check('an ordinary customer is refused the home content (403)', (await call('/api/business/home', shopperToken)).status === 403);

    // ─── The catalogue ─────────────────────────────────────
    const list = await call(`/api/business/catalogue/products?q=${encodeURIComponent(`QA Biz`)}&limit=60`, bizToken);
    check('the catalogue lists', list.status === 200, list.body?.error);
    const mine = (list.body?.data?.items ?? []).filter((p: { name_es: string }) => p.name_es.endsWith(stamp));
    const names = mine.map((p: { name_es: string }) => p.name_es.split(' ')[2]).sort();
    check('only the products with a wholesale size a business is shown: A and G', JSON.stringify(names) === '["A","G"]', names);
    const a = mine.find((p: { id: string }) => p.id === A.id);
    check('only the wholesale size is offered', a?.variants?.length === 1 && a.variants[0].name_es === 'Caja', a?.variants);
    const box = a?.variants?.[0];
    check('priced at wholesale less the agreed euro (6.50)', num(box?.price) === 6.5, box);
    check('its retail price (10) is nowhere in what a business is sent', !!box && !('retail_price' in box) && !/"10(\.0+)?"/.test(JSON.stringify(a)), box);
    check('b2b_price is shown to the business itself', num(box?.b2b_price) === 7.5, box);
    const g = mine.find((p: { id: string }) => p.id === G.id);
    check("Cesto's own business-only product, at wholesale", num(g?.variants?.[0]?.price) === 24, g?.variants);

    const byStore = await call(`/api/business/catalogue/products?storeId=${live.id}`, bizToken);
    check('a shop filter narrows to its products', (byStore.body?.data?.items ?? []).every((p: { store_id: string }) => p.store_id === live.id) && byStore.body?.data?.total === 1, byStore.body?.data?.total);
    const house = await call(`/api/business/catalogue/products?storeId=cesto&q=${encodeURIComponent(`QA Biz G ${stamp}`)}`, bizToken);
    check('"cesto" is Cesto\'s own catalogue', house.body?.data?.items?.[0]?.id === G.id, house.body?.data?.items);

    const page = await call(`/api/business/catalogue/products/${A.id}`, bizToken);
    check('a product page opens', page.status === 200 && page.body?.data?.variants?.length === 1, page.body?.error);
    check('a retail-only product is not found', (await call(`/api/business/catalogue/products/${B.id}`, bizToken)).status === 404);

    // ─── The browse cards ──────────────────────────────────
    const stores = await call('/api/business/catalogue/stores', bizToken);
    const liveCard = (stores.body?.data?.items ?? []).find((s: { id: string }) => s.id === live.id);
    check('the live shop is a card with 1 product (A)', liveCard?.products === 1, liveCard);
    check('the switched-off shop is no card', !(stores.body?.data?.items ?? []).some((s: { id: string }) => s.id === off.id));
    check("Cesto's own has a count", (stores.body?.data?.house?.products ?? 0) >= 1, stores.body?.data?.house);
    const brands = await call('/api/business/catalogue/brands', bizToken);
    const brandCard = (brands.body?.data ?? []).find((b: { id: string }) => b.id === brand.id);
    check('the brand card counts A and G', brandCard?.products === 2, brandCard);
    const origins = await call('/api/business/catalogue/origins', bizToken);
    check('the origin card counts A and G', (origins.body?.data ?? []).find((o: { id: string }) => o.id === origin.id)?.products === 2);
    const cats = await call('/api/business/catalogue/categories', bizToken);
    check('categories carry counts and none is empty', (cats.body?.data ?? []).length > 0 && (cats.body?.data ?? []).every((c: { products: number }) => c.products > 0));

    // ─── The summary's counts ──────────────────────────────
    const address = await prisma.address.create({
      data: { user_id: biz.id, contact_name: 'QA', contact_phone: '600000000', street_line_1: 'Calle QA 1', postcode: '28012', city: 'Madrid', province: 'Madrid' },
      select: { id: true },
    });
    const snap = { city: 'Madrid' };
    const order = (n: string, total: number, status: 'pending' | 'delivered' | 'cancelled', parent?: string) => prisma.order.create({
      data: {
        order_number: `QA-BIZ-${stamp}-${n}`, user_id: biz.id, address_id: address.id, address_snapshot: snap,
        subtotal: total, delivery_fee: 0, total, status, parent_order_id: parent ?? null,
      },
    });
    await order('1', 20, 'pending');
    const delivered = await order('2', 15, 'delivered');
    await order('3', 99, 'cancelled');
    const parent = await prisma.parentOrder.create({
      data: { order_number: `QA-BIZ-P-${stamp}`, user_id: biz.id, address_id: address.id, address_snapshot: snap, subtotal: 30, delivery_fee_total: 0, total: 30 },
    });
    await order('4', 10, 'pending', parent.id);
    await order('5', 20, 'pending', parent.id);

    const me = await call('/api/business/me', bizToken);
    const st = me.body?.data?.stats;
    check('orders: 2 standalone + 1 split purchase, the cancelled one left out = 3', st?.all_time?.orders === 3, st);
    check('spent: 20 + 15 + 10 + 20 = 65 (cancelled 99 left out)', num(st?.all_time?.spent) === 65, st?.all_time);
    check('this month the same', st?.this_month?.orders === 3 && num(st?.this_month?.spent) === 65, st?.this_month);
    check('in progress: the pending one and the split one = 2', st?.in_progress === 2, st);
    check('delivered: 1', st?.delivered === 1, st);
    check('the catalogue size is counted', (me.body?.data?.catalogue?.products ?? 0) >= 2, me.body?.data?.catalogue);

    // ─── Editing an order (the panel's edit screen, 2026-10-30) ──
    // A pending order from the live shop: 2 boxes of A at wholesale, 1 € off each.
    const boxA = A.variants.find((v) => v.name_es === 'Caja')!;
    const H = await mk('H', live.id, [{ name: 'Saco', price: 12, b2b: 9 }]);
    const editable = await prisma.order.create({
      data: {
        order_number: `QA-BIZ-${stamp}-E`, user_id: biz.id, address_id: address.id, address_snapshot: snap, store_id: live.id,
        subtotal: 13, delivery_fee: 0, total: 13, status: 'pending',
        items: {
          create: [{
            product_id: A.id, variant_id: boxA.id, quantity: 2, unit_price: 7.5, unit_discount: 1, discount_amount: 2, line_total: 13,
            product_snapshot: { name_es: `QA Biz A ${stamp}`, name_en: `QA Biz A ${stamp}`, image_url: '', variant_name_es: 'Caja', variant_name_en: 'Caja' },
          }],
        },
      },
      select: { id: true, items: { select: { id: true } } },
    });
    const lineA = editable.items[0].id;
    check('the catalogue says which IVA a product pays', typeof (list.body?.data?.items ?? [])[0]?.vat_category === 'string', (list.body?.data?.items ?? [])[0]);

    const foreignAdd = await put(`/api/orders/${editable.id}/items`, bizToken, { operations: [{ action: 'add', new_variant_id: G.variants[0].id, new_quantity: 1 }] });
    check("another shop's product is refused (the panel offers only the order's shop)", foreignAdd.status === 422, foreignAdd.body);
    const edited = await put(`/api/orders/${editable.id}/items`, bizToken, {
      operations: [
        { action: 'update_qty', order_item_id: lineA, new_quantity: 3 },
        { action: 'add', new_variant_id: H.variants[0].id, new_quantity: 2 },
      ],
    });
    check('a quantity changed and a same-shop product added in one save', edited.status === 200, edited.body);
    const after = await prisma.order.findUnique({
      where: { id: editable.id },
      select: { subtotal: true, items: { select: { variant_id: true, quantity: true, unit_price: true, unit_discount: true, line_total: true } } },
    });
    const a3 = after?.items.find((i) => i.variant_id === boxA.id);
    const h2 = after?.items.find((i) => i.variant_id === H.variants[0].id);
    check('the changed line keeps its agreed euro: 3 × (7.50 − 1) = 19.50', a3?.quantity === 3 && num(a3?.unit_discount) === 1 && num(a3?.line_total) === 19.5, a3);
    check('the added line is at wholesale: 2 × 9 = 18', num(h2?.unit_price) === 9 && num(h2?.line_total) === 18, h2);
    check('the order adds up: 19.50 + 18 = 37.50', num(after?.subtotal) === 37.5, after?.subtotal);

    const noted = await put(`/api/orders/${editable.id}/notes`, bizToken, { customer_notes: '  Por la puerta de atrás  ' });
    const note1 = await prisma.order.findUnique({ where: { id: editable.id }, select: { customer_notes: true } });
    check('the buyer changes their note, trimmed', noted.status === 200 && note1?.customer_notes === 'Por la puerta de atrás', { noted: noted.body, note1 });
    await put(`/api/orders/${editable.id}/notes`, bizToken, { customer_notes: '   ' });
    const note2 = await prisma.order.findUnique({ where: { id: editable.id }, select: { customer_notes: true } });
    check('an emptied note is no note', note2?.customer_notes === null, note2);
    const late = await put(`/api/orders/${delivered.id}/notes`, bizToken, { customer_notes: 'x' });
    check('a delivered order keeps its note (400)', late.status === 400, late.body);
    const theirs = await put(`/api/orders/${editable.id}/notes`, shopperToken, { customer_notes: 'x' });
    check("someone else's order is not found (404)", theirs.status === 404, theirs.body);

    // ─── The home's rails (2026-10-31) ─────────────────────
    // What they order most: the edited order now holds A and H.
    const usuals = await call('/api/business/catalogue/usuals', bizToken);
    const usualIds = (usuals.body?.data ?? []).map((p: { id: string }) => p.id);
    check('"what you order most" holds what they ordered', usuals.status === 200 && usualIds.includes(A.id) && usualIds.includes(H.id), usualIds);
    check('…priced wholesale, with no retail price', (usuals.body?.data ?? []).every((p: { variants: { retail_price?: unknown }[] }) => p.variants.length > 0 && p.variants.every((v) => !('retail_price' in v))));
    check('…and an ordinary customer is refused (403)', ((await call('/api/business/catalogue/usuals', shopperToken)).status === 403));
    const fresh = await call('/api/business/catalogue/new?limit=24', bizToken);
    const freshIds = (fresh.body?.data ?? []).map((p: { id: string }) => p.id);
    check('new in the catalogue: a list', fresh.status === 200 && Array.isArray(fresh.body?.data), fresh.body?.error);
    check('…of products a business can buy (no retail-only or household-only ones)', !freshIds.includes(B.id) && (fresh.body?.data ?? []).every((p: { variants: unknown[] }) => p.variants.length > 0), freshIds);
  } finally {
    if (userIds.length) {
      await prisma.notification.deleteMany({ where: { data: { path: ['order_number'], string_starts_with: `QA-BIZ-${stamp}` } } });
      await prisma.orderItem.deleteMany({ where: { order: { user_id: { in: userIds } } } });
      await prisma.order.deleteMany({ where: { user_id: { in: userIds } } });
      await prisma.parentOrder.deleteMany({ where: { user_id: { in: userIds } } });
      await prisma.address.deleteMany({ where: { user_id: { in: userIds } } });
      await prisma.customerProductDiscount.deleteMany({ where: { user_id: { in: userIds } } });
      await prisma.businessProfile.deleteMany({ where: { user_id: { in: userIds } } });
    }
    if (productIds.length) {
      await prisma.productVariant.deleteMany({ where: { product_id: { in: productIds } } });
      await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    }
    if (userIds.length) {
      await prisma.userRefreshToken.deleteMany({ where: { user_id: { in: userIds } } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    if (brandIds.length) await prisma.brand.deleteMany({ where: { id: { in: brandIds } } });
    if (originIds.length) await prisma.origin.deleteMany({ where: { id: { in: originIds } } });
    if (storeIds.length) await prisma.store.deleteMany({ where: { id: { in: storeIds } } });
    server.close();
    await prisma.$disconnect();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}


main().catch((err) => { console.error(err); process.exit(1); });
