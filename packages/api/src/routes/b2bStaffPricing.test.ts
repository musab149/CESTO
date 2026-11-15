// ─── Regression test · orders built FOR a wholesale client ─────────
//
// Run:  cd packages/api && npm run test:b2b-staff-pricing
//
// Reported 2026-10-11: an order built for a B2B client from the admin panel or
// the rep dashboard showed B2C prices. Two causes, both covered here:
//
//   1. The SERVER priced a staff- or rep-built order from the client's
//      storefront toggle (`pricing_mode`) rather than their account. A
//      business client whose toggle still read `retail` — one on production,
//      and anyone who never opens the website, since only /api/users/me
//      repairs it — was charged retail on every order built for them.
//
//   2. The rep's catalogue was never told who the order was for, so it
//      answered at retail. That half is a UI fix (the panel now sends
//      `for_client`); what is asserted here is the server contract the panel
//      relies on — same price on the card as on the order.
//
// The customer's OWN edits still follow their own toggle, as their checkout
// does. That is asserted too, so the two rules cannot quietly merge.
//
// Creates its own category, product, rep and clients and removes them.

import http from 'http';
import { Prisma } from '@prisma/client';
import app from '../server';
import prisma from '../lib/prisma';
import { generateAccessToken, generateAdminAccessToken } from '../lib/jwt';

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { passed++; console.log(`  PASS  ${name}`); }
  else {
    failed++; console.log(`  FAIL  ${name}`);
    if (detail !== undefined) console.log(`        ${JSON.stringify(detail)}`);
  }
}

const stamp = String(Date.now()).slice(-7);

async function main() {
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  const userIds: string[] = [];
  const orderIds: string[] = [];
  let productId: string | null = null;
  let categoryId: string | null = null;

  type Res = { status: number; body: { data?: any; error?: string } };
  const call = async (path: string, init: { method?: string; body?: unknown; token?: string } = {}): Promise<Res> => {
    const res = await fetch(`${base}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    return { status: res.status, body: await res.json() as Res['body'] };
  };

  try {
    const admin = await prisma.admin.findFirst({ select: { id: true, email: true, role: true } });
    if (!admin) { console.log('  SKIP  no admin row to act as'); return; }
    const adminToken = generateAdminAccessToken({ adminId: admin.id, email: admin.email, role: admin.role });

    // ─── Fixtures ────────────────────────────────────────────
    const category = await prisma.category.create({
      data: { name_es: `B2BP ${stamp}`, name_en: `B2BP ${stamp}`, sort_order: 9999 },
      select: { id: true },
    });
    categoryId = category.id;
    const productName = `Aceite B2BP ${stamp}`;
    const product = await prisma.product.create({
      data: {
        name_es: productName, name_en: `B2BP oil ${stamp}`,
        category_id: categoryId, is_active: true,
        variants: {
          create: [
            { name_es: '1 L', name_en: '1 L', price: new Prisma.Decimal('10.00'), b2b_price: new Prisma.Decimal('7.50'), stock_quantity: 50, is_default: true, is_active: true },
            { name_es: '5 L', name_en: '5 L', price: new Prisma.Decimal('40.00'), b2b_price: new Prisma.Decimal('30.00'), stock_quantity: 50, is_default: false, is_active: true },
            { name_es: '10 L', name_en: '10 L', price: new Prisma.Decimal('70.00'), b2b_price: new Prisma.Decimal('55.00'), stock_quantity: 50, is_default: false, is_active: true },
          ],
        },
      },
      include: { variants: { orderBy: { price: 'asc' } } },
    });
    productId = product.id;
    const [v1, v5, v10] = product.variants;

    const rep = await prisma.user.create({
      data: { name: `B2BP Rep ${stamp}`, email: `b2bp.rep.${stamp}@cesto-test.invalid` },
    });
    userIds.push(rep.id);
    await prisma.salesRep.create({ data: { user_id: rep.id, is_active: true, house_store: true } }); // its products are Cesto's own (lib/repStore)
    const repToken = generateAccessToken({ userId: rep.id, email: rep.email ?? undefined });

    const mkClient = async (tag: string, isBusiness: boolean, mode: 'retail' | 'b2b') => {
      const u = await prisma.user.create({
        data: {
          name: `B2BP ${tag} ${stamp}`, email: `b2bp.${tag}.${stamp}@cesto-test.invalid`,
          is_business: isBusiness, pricing_mode: mode,
          // In the rep's book, so the rep routes will serve them.
          created_by_sales_rep_id: rep.id,
        },
      });
      userIds.push(u.id);
      const a = await prisma.address.create({
        data: {
          user_id: u.id, contact_name: 'B2BP', contact_phone: '600000000',
          street_line_1: 'Calle 1', postcode: '28001', city: 'Madrid', province: 'Madrid', is_default: true,
        },
      });
      return { id: u.id, addressId: a.id, token: generateAccessToken({ userId: u.id, email: u.email ?? undefined }) };
    };
    // THE CASE THAT WAS BROKEN: a business account whose storefront toggle
    // still reads retail.
    const stale = await mkClient('stale', true, 'retail');
    const retail = await mkClient('retail', false, 'retail');

    const unitOf = (order: { items?: Array<{ variant_id: string; unit_price: string }> } | undefined, variantId: string) =>
      Number(order?.items?.find((i) => i.variant_id === variantId)?.unit_price);

    // ─── 1 · Admin builds the order ──────────────────────────
    console.log('\n1 · Admin-built order');
    const a1 = await call('/api/admin/orders', {
      method: 'POST', token: adminToken,
      body: { user_id: stale.id, address_id: stale.addressId, items: [{ variant_id: v1.id, quantity: 2 }] },
    });
    check('admin create answers 201', a1.status === 201, a1.body.error);
    const staleOrderId: string | undefined = a1.body.data?.order?.id;
    if (staleOrderId) orderIds.push(staleOrderId);
    check('WHOLESALE for a business client whose toggle says retail', unitOf(a1.body.data?.order, v1.id) === 7.5,
      unitOf(a1.body.data?.order, v1.id));
    check('subtotal is wholesale too', Number(a1.body.data?.order?.subtotal) === 15, a1.body.data?.order?.subtotal);

    const a2 = await call('/api/admin/orders', {
      method: 'POST', token: adminToken,
      body: { user_id: retail.id, address_id: retail.addressId, items: [{ variant_id: v1.id, quantity: 1 }] },
    });
    if (a2.body.data?.order?.id) orderIds.push(a2.body.data.order.id);
    check('retail client still pays retail', unitOf(a2.body.data?.order, v1.id) === 10, unitOf(a2.body.data?.order, v1.id));

    // ─── 2 · Admin edits it ──────────────────────────────────
    console.log('\n2 · Admin adds a line');
    if (staleOrderId) {
      const e1 = await call(`/api/admin/orders/${staleOrderId}/items`, {
        method: 'PUT', token: adminToken,
        body: { operations: [{ action: 'add', new_variant_id: v5.id, new_quantity: 1 }] },
      });
      check('admin edit answers 200', e1.status === 200, e1.body.error);
      const line = await prisma.orderItem.findFirst({ where: { order_id: staleOrderId, variant_id: v5.id } });
      check('a line staff add is wholesale', Number(line?.unit_price) === 30, line?.unit_price);
    }

    // ─── 3 · The rep's catalogue ─────────────────────────────
    console.log('\n3 · Rep catalogue');
    const priceIn = (r: Res, variantId: string) => {
      const p = (r.body.data?.items ?? []).find((x: { id: string }) => x.id === productId);
      return Number(p?.variants?.find((v: { id: string }) => v.id === variantId)?.price);
    };
    const q = `q=${encodeURIComponent(productName)}&limit=60`;
    const cStale = await call(`/api/sales/catalogue/products?for_client=${stale.id}&${q}`, { token: repToken });
    check('catalogue for the business client quotes wholesale', priceIn(cStale, v1.id) === 7.5, priceIn(cStale, v1.id));
    const cRetail = await call(`/api/sales/catalogue/products?for_client=${retail.id}&${q}`, { token: repToken });
    check('catalogue for the retail client quotes retail', priceIn(cRetail, v1.id) === 10, priceIn(cRetail, v1.id));
    const cNone = await call(`/api/sales/catalogue/products?${q}`, { token: repToken });
    check('catalogue with no client quotes retail', priceIn(cNone, v1.id) === 10, priceIn(cNone, v1.id));

    // ─── 4 · The rep builds the order ────────────────────────
    console.log('\n4 · Rep-built order');
    const r1 = await call('/api/sales/orders', {
      method: 'POST', token: repToken,
      body: { user_id: stale.id, address_id: stale.addressId, items: [{ variant_id: v1.id, quantity: 1 }] },
    });
    check('rep create answers 201', r1.status === 201, r1.body.error);
    if (r1.body.data?.order?.id) orderIds.push(r1.body.data.order.id);
    check('rep order is wholesale, matching the card', unitOf(r1.body.data?.order, v1.id) === priceIn(cStale, v1.id),
      unitOf(r1.body.data?.order, v1.id));

    // ─── 5 · The customer edits their own order ──────────────
    console.log('\n5 · Customer self-edit keeps their own view');
    if (staleOrderId) {
      const c1 = await call(`/api/orders/${staleOrderId}/items`, {
        method: 'PUT', token: stale.token,
        body: { operations: [{ action: 'add', new_variant_id: v10.id, new_quantity: 1 }] },
      });
      check('customer edit answers 200', c1.status === 200, c1.body.error);
      const line = await prisma.orderItem.findFirst({ where: { order_id: staleOrderId, variant_id: v10.id } });
      check('a line the customer adds follows THEIR toggle (retail here)', Number(line?.unit_price) === 70, line?.unit_price);
    }

    const after = await prisma.user.findUnique({ where: { id: stale.id }, select: { pricing_mode: true } });
    check('building orders never rewrites the client\'s toggle', after?.pricing_mode === 'retail');
  } finally {
    if (orderIds.length) {
      const idStrings = orderIds.map((id) => Prisma.sql`${id}`);
      await prisma.$executeRaw`DELETE FROM notifications WHERE data->>'order_id' IN (${Prisma.join(idStrings)})`;
      await prisma.orderEditLog.deleteMany({ where: { order_id: { in: orderIds } } });
      await prisma.orderItem.deleteMany({ where: { order_id: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    if (userIds.length) {
      await prisma.notification.deleteMany({ where: { user_id: { in: userIds } } });
      await prisma.salesRep.deleteMany({ where: { user_id: { in: userIds } } });
      await prisma.address.deleteMany({ where: { user_id: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    if (productId) {
      await prisma.productVariant.deleteMany({ where: { product_id: productId } });
      await prisma.product.deleteMany({ where: { id: productId } });
    }
    if (categoryId) await prisma.category.deleteMany({ where: { id: categoryId } });
    server.close();
    await prisma.$disconnect();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
