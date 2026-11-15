// ─── Integration test · who hears about an order ───────────────────────────
//
// Run:  cd packages/api && npm run test:order-notifications
//
// Three gaps, closed together on 2026-10-15:
//
//   · A PARTNER heard about nothing. A customer's purchase split into a part
//     for their shop and they learnt of it only by opening the dashboard —
//     68 parts sat at `pending` on production at shops whose partner had a
//     login and had never been told. Nor did anyone tell them when the
//     customer or Cesto changed or cancelled a part they were packing.
//
//   · An order OUR TEAM built told its customer nothing until the first
//     status change, and a rep's order reached nobody in the office.
//
//   · Editing a staff-built order to add a partner's product split it off
//     onto that partner's dashboard, though building the same basket in one
//     go keeps it whole and Cesto's.
//
// Goes through the real routes over HTTP and reads the notifications table,
// which is what the bells read. Creates its own shops, logins, customer and
// products, and removes them in a finally. Mail goes to the console mailer
// under test (see lib/mailer pickMailer), so nothing real is sent.
import http from 'http';
import app from '../server';
import prisma from '../lib/prisma';
import { generateAccessToken, generateAdminAccessToken } from '../lib/jwt';
import { announceOrderBuiltForCustomer } from '../lib/notifications';

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
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

  const call = async (path: string, init: { method?: string; body?: unknown; token?: string } = {}) => {
    const res = await fetch(`${base}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: res.status, body: await res.json() as { success: boolean; error?: string; data?: any } };
  };

  const userIds: string[] = [];
  const storeIds: string[] = [];
  const productIds: string[] = [];

  try {
    const admin = await prisma.admin.findFirst({ select: { id: true, email: true, role: true } });
    const category = await prisma.category.findFirst({ select: { id: true } });
    if (!admin || !category) { console.log('  SKIP  needs an admin and a category to work with'); return; }
    const adminToken = generateAdminAccessToken({ adminId: admin.id, email: admin.email, role: admin.role });

    // ── Fixtures ─────────────────────────────────────────────
    const shop = await prisma.store.create({
      data: { name: `QA Notify Shop ${stamp}`, slug: `qa-notify-${stamp}`, status: 'live', is_active: true },
      select: { id: true },
    });
    const otherShop = await prisma.store.create({
      data: { name: `QA Notify Other ${stamp}`, slug: `qa-notify-other-${stamp}`, status: 'live', is_active: true },
      select: { id: true },
    });
    storeIds.push(shop.id, otherShop.id);

    const mkUser = async (tag: string) => {
      const u = await prisma.user.create({
        data: { name: `QA ${tag} ${stamp}`, email: `qa.notify.${tag}.${stamp}@cesto.test`, status: 'active' },
        select: { id: true, email: true },
      });
      userIds.push(u.id);
      return { ...u, token: generateAccessToken({ userId: u.id, email: u.email ?? undefined }) };
    };
    const partner = await mkUser('partner');
    const otherPartner = await mkUser('otherpartner');
    const customer = await mkUser('customer');
    await prisma.partnerStoreRole.create({ data: { user_id: partner.id, store_id: shop.id, role: 'owner' } });
    await prisma.partnerStoreRole.create({ data: { user_id: otherPartner.id, store_id: otherShop.id, role: 'owner' } });

    const address = await prisma.address.create({
      data: {
        user_id: customer.id, contact_name: 'QA', contact_phone: '600000000',
        street_line_1: 'C/ Test 1', postcode: '28016', city: 'Madrid', province: 'Madrid',
      },
      select: { id: true },
    });

    const mkProduct = async (name: string, storeId: string | null, stock: number) => {
      const p = await prisma.product.create({
        data: {
          name_es: `${name} ${stamp}`, name_en: `${name} ${stamp}`, store_id: storeId, category_id: category.id,
          variants: { create: [{ name_es: '1 kg', name_en: '1 kg', price: 5, stock_quantity: stock, is_default: true }] },
        },
        select: { id: true, variants: { select: { id: true } } },
      });
      productIds.push(p.id);
      return { productId: p.id, variantId: p.variants[0].id };
    };
    const shopItem = await mkProduct('QA Shop Atta', shop.id, 50);
    const cestoItem = await mkProduct('QA Cesto Dal', null, 50);

    // The partner's inbox, read the way their bell reads it.
    const inbox = async (who = partner) =>
      ((await call('/api/partner/notifications?limit=50', { token: who.token })).body.data?.items ?? []) as
        Array<{ id: string; type: string; body_es: string; deeplink: string; read: boolean; data: { order_id: string } }>;
    /** Fire-and-forget on the server, so give it a moment to land. */
    const until = async <T>(read: () => Promise<T>, ok: (v: T) => boolean): Promise<T> => {
      let v = await read();
      for (let i = 0; i < 40 && !ok(v); i++) { await wait(100); v = await read(); }
      return v;
    };
    const checkout = async (lines: Array<{ productId: string; variantId: string; quantity: number }>) => {
      await call('/api/cart', { method: 'PUT', token: customer.token, body: { items: lines } });
      return call('/api/orders', { method: 'POST', token: customer.token, body: { addressId: address.id, paymentMethod: 'cod' } });
    };
    const partOf = (placed: { body: { data?: { orders?: Array<{ id: string; store_id: string | null }> } } }, storeId: string | null) =>
      placed.body.data?.orders?.find((o) => o.store_id === storeId)?.id;

    // ── 1. A split checkout tells the shop about ITS part ────
    console.log('\nA customer checkout split across Cesto and a partner shop');
    const placed = await checkout([
      { ...shopItem, quantity: 2 },
      { ...cestoItem, quantity: 1 },
    ]);
    check('the checkout splits into a parent and two parts',
      placed.status === 201 && placed.body.data?.orders?.length === 2,
      { status: placed.status, error: placed.body.error, parts: placed.body.data?.orders?.length });
    const shopPart = partOf(placed, shop.id)!;
    const cestoPart = partOf(placed, null)!;

    let mine = await until(() => inbox(), (r) => r.some((n) => n.data?.order_id === shopPart));
    const fresh = mine.find((n) => n.data?.order_id === shopPart);
    check('the partner gets a "new order" for their part', fresh?.type === 'partner_new_order', mine);
    check('...linking to it on their dashboard', fresh?.deeplink === `/partner/orders/${shopPart}`, fresh?.deeplink);
    check('...and nothing about Cesto\'s part', !mine.some((n) => n.data?.order_id === cestoPart));

    const count = (await call('/api/partner/notifications/unread-count', { token: partner.token })).body.data?.count;
    check('their bell counts it as unread', count === 1, count);
    await call(`/api/partner/notifications/${fresh!.id}/read`, { method: 'POST', token: partner.token });
    const after = (await call('/api/partner/notifications/unread-count', { token: partner.token })).body.data?.count;
    check('...and marking it read clears the count', after === 0, after);

    const elsewhere = await inbox(otherPartner);
    check('another shop\'s login sees none of it', !elsewhere.some((n) => n.data?.order_id === shopPart), elsewhere.length);
    const asCustomer = (await call('/api/notifications?limit=50', { token: partner.token })).body.data?.items ?? [];
    check('...and it stays out of the partner\'s own shopping bell',
      !(asCustomer as Array<{ type: string }>).some((n) => n.type.startsWith('partner_')));

    // ── 2. The customer changes it, then cancels it ──────────
    console.log('\nThe customer changes, then cancels, the partner\'s part');
    const line = await prisma.orderItem.findFirst({ where: { order_id: shopPart }, select: { id: true } });
    const edit = await call(`/api/orders/${shopPart}/items`, {
      method: 'PUT', token: customer.token,
      body: { operations: [{ action: 'update_qty', order_item_id: line!.id, new_quantity: 3 }] },
    });
    check('the customer edits it', edit.status === 200, { status: edit.status, error: edit.body.error });
    mine = await until(() => inbox(), (r) => r.some((n) => n.type === 'partner_order_edited'));
    check('the partner is told it changed', mine.some((n) => n.type === 'partner_order_edited' && n.data?.order_id === shopPart));

    const cancel = await call(`/api/orders/${shopPart}/cancel`, {
      method: 'POST', token: customer.token, body: { reason: 'Me equivoqué' },
    });
    check('the customer cancels it', cancel.status === 200, { status: cancel.status, error: cancel.body.error });
    mine = await until(() => inbox(), (r) => r.some((n) => n.type === 'partner_order_cancelled'));
    const gone = mine.find((n) => n.type === 'partner_order_cancelled');
    check('the partner is told to stop, with the reason', !!gone && gone.body_es.includes('Me equivoqué'), gone?.body_es);

    // ── 3. The partner's own work is not announced back ──────
    console.log('\nThe partner moves their own order, then Cesto cancels it');
    const second = await checkout([{ ...shopItem, quantity: 1 }]);
    const solo = second.body.data?.id as string;
    check('a single-shop checkout is one order at that shop', second.status === 201 && !!solo,
      { status: second.status, error: second.body.error });
    await until(() => inbox(), (r) => r.some((n) => n.data?.order_id === solo));
    const before = (await inbox()).length;
    const confirm = await call(`/api/partner/orders/${solo}/status`, {
      method: 'PUT', token: partner.token, body: { status: 'confirmed' },
    });
    check('the partner confirms it', confirm.status === 200, { status: confirm.status, error: confirm.body.error });
    await wait(500);
    check('...and is not notified of their own action', (await inbox()).length === before);

    const adminCancel = await call(`/api/admin/orders/${solo}/status`, {
      method: 'PUT', token: adminToken, body: { status: 'cancelled', reason: 'Sin reparto hoy' },
    });
    check('Cesto cancels it from the panel', adminCancel.status === 200, { status: adminCancel.status, error: adminCancel.body.error });
    mine = await until(() => inbox(), (r) => r.some((n) => n.type === 'partner_order_cancelled' && n.data?.order_id === solo));
    const byCesto = mine.find((n) => n.type === 'partner_order_cancelled' && n.data?.order_id === solo);
    check('the partner is told Cesto cancelled it', !!byCesto && byCesto.body_es.startsWith('Cesto'), byCesto?.body_es);

    // ── 4. Waiting on stock, then real ────────────────────────
    console.log('\nA part the shop has no stock for');
    await prisma.productVariant.update({ where: { id: shopItem.variantId }, data: { stock_quantity: 1 } });
    const short = await checkout([{ ...shopItem, quantity: 3 }]);
    const draftId = short.body.data?.id as string;
    check('a checkout short on stock parks a draft', short.status === 201 && short.body.data?.status === 'draft',
      { status: short.status, orderStatus: short.body.data?.status, error: short.body.error });
    mine = await until(() => inbox(), (r) => r.some((n) => n.type === 'partner_draft_order' && n.data?.order_id === draftId));
    check('the partner is told it is waiting on their stock',
      mine.some((n) => n.type === 'partner_draft_order' && n.data?.order_id === draftId));

    await prisma.productVariant.update({ where: { id: shopItem.variantId }, data: { stock_quantity: 50 } });
    const resolved = await call(`/api/admin/orders/${draftId}/confirm-stock`, { method: 'POST', token: adminToken });
    check('Cesto confirms the stock', resolved.status === 200, { status: resolved.status, error: resolved.body.error });
    mine = await until(() => inbox(), (r) => r.some((n) => n.type === 'partner_new_order' && n.data?.order_id === draftId));
    check('...and the partner now gets it as a new order to fulfil',
      mine.some((n) => n.type === 'partner_new_order' && n.data?.order_id === draftId));

    // ── 5. An order our team builds ───────────────────────────
    console.log('\nAn order staff build for the customer, with the partner\'s product in it');
    const partnerBefore = (await inbox()).length;
    const built = await call('/api/admin/orders', {
      method: 'POST', token: adminToken,
      body: { user_id: customer.id, address_id: address.id, items: [{ variant_id: cestoItem.variantId, quantity: 1 }] },
    });
    const builtId = built.body.data?.order?.id as string;
    check('staff build an order', built.status === 201 && !!builtId, { status: built.status, error: built.body.error });

    const told = await until(
      () => prisma.notification.findMany({ where: { audience: 'customer', user_id: customer.id, type: 'order_placed' } }),
      (r) => r.length > 0,
    );
    check('the customer is told an order was placed for them',
      told.some((n) => (n.data as { order_id?: string } | null)?.order_id === builtId), told.length);
    const officePing = await prisma.notification.count({
      where: { audience: 'admin', type: 'admin_new_order', data: { path: ['order_id'], equals: builtId } },
    });
    check('...and the office is not pinged about its own order', officePing === 0, officePing);

    const add = await call(`/api/admin/orders/${builtId}/items`, {
      method: 'PUT', token: adminToken,
      body: { operations: [{ action: 'add', new_variant_id: shopItem.variantId, new_quantity: 1 }] },
    });
    check('staff add the partner\'s product to it', add.status === 200, { status: add.status, error: add.body.error });
    check('...and nothing is split off', (add.body.data?.newOrders?.length ?? -1) === 0, add.body.data?.newOrders);
    const builtNow = await prisma.order.findUnique({
      where: { id: builtId },
      select: { store_id: true, parent_order_id: true, _count: { select: { items: true } } },
    });
    check('...it is still one Cesto order, holding both lines',
      builtNow?.store_id === null && builtNow.parent_order_id === null && builtNow._count.items === 2, builtNow);
    await wait(500);
    check('...and the partner hears nothing about it', (await inbox()).length === partnerBefore);

    // A rep's order: same announcement, plus the office.
    const repUser = await mkUser('rep');
    await prisma.order.update({
      where: { id: builtId },
      data: { created_by_admin_id: null, created_by_sales_rep_id: repUser.id },
    });
    await announceOrderBuiltForCustomer({ orderId: builtId });
    const repPing = await until(
      () => prisma.notification.count({
        where: { audience: 'admin', type: 'admin_new_order', data: { path: ['order_id'], equals: builtId } },
      }),
      (n) => n > 0,
    );
    check('a rep\'s order pings the office, which would not otherwise know of it', repPing === 1, repPing);
  } finally {
    // Every notification about these orders, every audience.
    const orders = await prisma.order.findMany({ where: { user_id: { in: userIds } }, select: { id: true, parent_order_id: true } });
    const orderIds = orders.map((o) => o.id);
    const parentIds = [...new Set(orders.map((o) => o.parent_order_id).filter((x): x is string => !!x))];
    for (const id of orderIds) {
      await prisma.notification.deleteMany({ where: { data: { path: ['order_id'], equals: id } } });
    }
    await prisma.notification.deleteMany({ where: { user_id: { in: userIds } } });
    await prisma.orderEditLog.deleteMany({ where: { order_id: { in: orderIds } } }).catch(() => {});
    await prisma.orderIdempotency.deleteMany({ where: { user_id: { in: userIds } } });
    await prisma.orderItem.deleteMany({ where: { order_id: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.parentOrder.deleteMany({ where: { id: { in: parentIds } } });
    await prisma.cartItem.deleteMany({ where: { user_id: { in: userIds } } });
    await prisma.address.deleteMany({ where: { user_id: { in: userIds } } });
    await prisma.partnerStoreRole.deleteMany({ where: { user_id: { in: userIds } } });
    await prisma.productVariant.deleteMany({ where: { product_id: { in: productIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    await prisma.store.deleteMany({ where: { id: { in: storeIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    server.close();
    await prisma.$disconnect();
  }

  console.log(`\n${passed}/${passed + failed} passed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
