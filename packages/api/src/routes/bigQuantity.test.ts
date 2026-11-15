// ─── Integration test · lines with thousands of units ───────────────────
//
// Run:  cd packages/api && npm run test:big-quantity
//
// A 5,000-unit order is a few hundred lines, and some of them are big: a
// shop takes a thousand of one product. The quantity limits used to be
// scattered and small — 99 a line when a customer edited an order, 999 when
// an admin or a rep created one — so a big line could be placed one way and
// then not edited, or not built by staff at all. MAX_LINE_QUANTITY (10,000)
// is now the one ceiling, and stock is the real limit.
//
// What has to hold, for the customer, the admin and the rep:
//   · a 5,000-unit line goes through placing, editing and cancelling;
//   · stock moves by exactly the quantity at every step, and is back where it
//     started once the order is cancelled;
//   · 10,001 is refused everywhere, with nothing moved.
//
// Goes through the real routes over HTTP. Raises the stock of three variants
// for the run and puts every one back in a finally.
import http from 'http';
import app from '../server';
import prisma from '../lib/prisma';
import { generateAccessToken, generateAdminAccessToken } from '../lib/jwt';
import { busiestShop, repShop } from '../lib/testRepShop';
import { MAX_LINE_QUANTITY } from '../lib/orderLimits';

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
const STOCK = 30_000;
const BIG = 5_000;

async function main() {
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

  const userIds: string[] = [];
  /** variant id -> stock before the test touched it. */
  const opening = new Map<string, number>();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const call = async (path: string, init: { method?: string; body?: unknown; token: string }): Promise<{ status: number; error?: string; data?: any }> => {
    const res = await fetch(`${base}${path}`, {
      method: init.method ?? 'GET',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${init.token}` },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const json = await res.json() as { error?: string; data?: unknown };
    return { status: res.status, error: json.error, data: json.data };
  };
  const stockOf = async (id: string) =>
    (await prisma.productVariant.findUnique({ where: { id }, select: { stock_quantity: true } }))!.stock_quantity;

  try {
    // A rep sells from one shop (lib/repStore): the products come from one, and the rep is given it.
    const shopId = await busiestShop();
    const variants = await prisma.productVariant.findMany({
      where: { is_active: true, product: { is_active: true, store_id: shopId } },
      select: { id: true, product_id: true, stock_quantity: true },
      take: 3,
    });
    if (variants.length < 3) { console.log('  SKIP  not enough variants'); return; }
    for (const v of variants) opening.set(v.id, v.stock_quantity);
    await prisma.productVariant.updateMany({ where: { id: { in: variants.map((v) => v.id) } }, data: { stock_quantity: STOCK } });
    const [a, b, c] = variants;

    const admin = await prisma.admin.findFirst({ select: { id: true, email: true, role: true } });
    if (!admin) { console.log('  SKIP  no admin row to act as'); return; }
    const adminToken = generateAdminAccessToken({ adminId: admin.id, email: admin.email, role: admin.role });

    const customer = await prisma.user.create({ data: { name: `QA BigQty ${stamp}`, email: `qa.bigqty.${stamp}@cesto.test` } });
    userIds.push(customer.id);
    const custToken = generateAccessToken({ userId: customer.id, email: customer.email ?? undefined });
    const custAddress = await prisma.address.create({ data: {
      user_id: customer.id, contact_name: 'QA', contact_phone: '600000005',
      street_line_1: 'C/ Cantidad 1', postcode: '28016', city: 'Madrid', province: 'Madrid',
    } });

    const rep = await prisma.user.create({ data: { name: `QA BigQty Rep ${stamp}`, email: `qa.bigqty.rep.${stamp}@cesto.test` } });
    userIds.push(rep.id);
    await prisma.salesRep.create({ data: { user_id: rep.id, is_active: true, ...repShop(shopId) } });
    const repToken = generateAccessToken({ userId: rep.id, email: rep.email ?? undefined });
    const client = await prisma.user.create({ data: {
      name: `QA BigQty Client ${stamp}`, email: `qa.bigqty.client.${stamp}@cesto.test`, created_by_sales_rep_id: rep.id,
    } });
    userIds.push(client.id);
    const clientAddress = await prisma.address.create({ data: {
      user_id: client.id, contact_name: 'QA', contact_phone: '600000006',
      street_line_1: 'C/ Cantidad 2', postcode: '28016', city: 'Madrid', province: 'Madrid',
    } });

    // ─── Customer ─────────────────────────────────────────
    const tooMany = await call('/api/cart', { method: 'PUT', token: custToken, body: { items: [
      { productId: a.product_id, variantId: a.id, quantity: MAX_LINE_QUANTITY + 1 },
    ] } });
    check(`customer: a ${MAX_LINE_QUANTITY + 1}-unit line is refused at the cart`, tooMany.status === 400 || tooMany.status === 422, tooMany);

    const sync = await call('/api/cart', { method: 'PUT', token: custToken, body: { items: [
      { productId: a.product_id, variantId: a.id, quantity: BIG },
      { productId: b.product_id, variantId: b.id, quantity: 300 },
      { productId: c.product_id, variantId: c.id, quantity: 1 },
    ] } });
    check(`customer: a basket with a ${BIG}-unit line saves`, sync.status === 200, sync);

    const quote = await call('/api/orders/quote', { method: 'POST', token: custToken, body: { addressId: custAddress.id } });
    check('customer: it prices, with no stock issues', quote.status === 200 && (quote.data?.issues ?? []).length === 0, quote);

    const placed = await call('/api/orders', { method: 'POST', token: custToken, body: { addressId: custAddress.id, paymentMethod: 'cod' } });
    check('customer: the order is placed', placed.status === 201, placed);
    const custOrders: Array<{ id: string; items: Array<{ id: string; variant_id: string; quantity: number }> }> =
      placed.data?.orders ?? (placed.data?.id ? [placed.data] : []);
    check(`customer: stock fell by exactly ${BIG}`, (await stockOf(a.id)) === STOCK - BIG, { a: await stockOf(a.id) });

    const withA = custOrders.find((o) => o.items.some((it) => it.variant_id === a.id));
    const lineA = withA?.items.find((it) => it.variant_id === a.id);
    if (withA && lineA) {
      // This was refused outright: a customer could not edit a line above 99.
      const edit = await call(`/api/orders/${withA.id}/items`, { method: 'PUT', token: custToken, body: { operations: [
        { action: 'update_qty', order_item_id: lineA.id, new_quantity: 4200 },
      ] } });
      check(`customer: editing the line from ${BIG} to 4200 works (was capped at 99)`, edit.status === 200, edit);
      check('customer: 800 units went back to stock', (await stockOf(a.id)) === STOCK - 4200, { a: await stockOf(a.id) });

      const over = await call(`/api/orders/${withA.id}/items`, { method: 'PUT', token: custToken, body: { operations: [
        { action: 'update_qty', order_item_id: lineA.id, new_quantity: MAX_LINE_QUANTITY + 1 },
      ] } });
      check(`customer: editing to ${MAX_LINE_QUANTITY + 1} is refused`, over.status === 400 || over.status === 422, over);
      check('customer: and nothing moved', (await stockOf(a.id)) === STOCK - 4200);
    } else {
      check('customer: the order holds the big line', false, placed.data);
    }

    for (const o of custOrders) {
      const cancel = await call(`/api/orders/${o.id}/cancel`, { method: 'POST', token: custToken, body: { reason: 'QA big quantity' } });
      check(`customer: cancelling ${o.id.slice(0, 8)} works`, cancel.status === 200, cancel);
    }
    check('customer: every unit is back after the cancel',
      (await stockOf(a.id)) === STOCK && (await stockOf(b.id)) === STOCK && (await stockOf(c.id)) === STOCK,
      { a: await stockOf(a.id), b: await stockOf(b.id), c: await stockOf(c.id) });

    // ─── Admin ────────────────────────────────────────────
    const aOver = await call('/api/admin/orders', { method: 'POST', token: adminToken, body: {
      user_id: customer.id, address_id: custAddress.id, items: [{ variant_id: a.id, quantity: MAX_LINE_QUANTITY + 1 }],
    } });
    check(`admin: a ${MAX_LINE_QUANTITY + 1}-unit line is refused`, aOver.status === 400 || aOver.status === 422, aOver);

    const aCreate = await call('/api/admin/orders', { method: 'POST', token: adminToken, body: {
      user_id: customer.id, address_id: custAddress.id, items: [{ variant_id: a.id, quantity: 6000 }, { variant_id: b.id, quantity: 2 }],
    } });
    check('admin: a 6000-unit line is created (was capped at 999)', aCreate.status === 201, aCreate);
    check('admin: stock fell by exactly 6000', (await stockOf(a.id)) === STOCK - 6000);
    const adminOrder = aCreate.data?.order;
    if (adminOrder) {
      const itemA = adminOrder.items.find((it: { variant_id: string }) => it.variant_id === a.id);
      const edit = await call(`/api/admin/orders/${adminOrder.id}/items`, { method: 'PUT', token: adminToken, body: { operations: [
        { action: 'update_qty', order_item_id: itemA.id, new_quantity: 7500 },
      ] } });
      check('admin: editing it to 7500 works', edit.status === 200, edit);
      check('admin: 1500 more units were taken', (await stockOf(a.id)) === STOCK - 7500);
      const over = await call(`/api/admin/orders/${adminOrder.id}/items`, { method: 'PUT', token: adminToken, body: { operations: [
        { action: 'update_qty', order_item_id: itemA.id, new_quantity: MAX_LINE_QUANTITY + 1 },
      ] } });
      check(`admin: editing to ${MAX_LINE_QUANTITY + 1} is refused`, over.status === 400 || over.status === 422, over);
      const cancel = await call(`/api/admin/orders/${adminOrder.id}/status`, { method: 'PUT', token: adminToken, body: { status: 'cancelled', reason: 'QA big quantity' } });
      check('admin: cancelling it works', cancel.status === 200, cancel);
      check('admin: every unit is back', (await stockOf(a.id)) === STOCK && (await stockOf(b.id)) === STOCK,
        { a: await stockOf(a.id), b: await stockOf(b.id) });
    }

    // ─── Rep ──────────────────────────────────────────────
    const rCreate = await call('/api/sales/orders', { method: 'POST', token: repToken, body: {
      user_id: client.id, address_id: clientAddress.id, items: [{ variant_id: a.id, quantity: BIG }],
    } });
    check(`rep: a ${BIG}-unit line is created`, rCreate.status === 201, rCreate);
    check(`rep: stock fell by exactly ${BIG}`, (await stockOf(a.id)) === STOCK - BIG);
    const repOrder = rCreate.data?.order;
    if (repOrder) {
      const detail = await call(`/api/sales/orders/${repOrder.id}`, { token: repToken });
      const items = detail.data?.items ?? detail.data?.order?.items ?? [];
      const itemA = items.find((it: { variant_id: string }) => it.variant_id === a.id);
      const edit = await call(`/api/sales/orders/${repOrder.id}/items`, { method: 'PUT', token: repToken, body: { operations: [
        { action: 'update_qty', order_item_id: itemA.id, new_quantity: 5500 },
      ] } });
      check('rep: editing it to 5500 works', edit.status === 200, edit);
      check('rep: 500 more units were taken', (await stockOf(a.id)) === STOCK - 5500);
      const cancel = await call(`/api/sales/orders/${repOrder.id}/cancel`, { method: 'PUT', token: repToken, body: { reason: 'QA big quantity' } });
      check('rep: cancelling it works', cancel.status === 200, cancel);
      check('rep: every unit is back', (await stockOf(a.id)) === STOCK, { a: await stockOf(a.id) });
    }
  } finally {
    const orders = await prisma.order.findMany({ where: { user_id: { in: userIds } }, select: { id: true, parent_order_id: true } });
    const orderIds = orders.map((o) => o.id);
    const parentIds = [...new Set(orders.map((o) => o.parent_order_id).filter((x): x is string => !!x))];
    await prisma.orderIdempotency.deleteMany({ where: { user_id: { in: userIds } } });
    await prisma.notification.deleteMany({ where: { user_id: { in: userIds } } });
    if (orderIds.length) {
      await prisma.orderEditLog.deleteMany({ where: { order_id: { in: orderIds } } });
      await prisma.orderItem.deleteMany({ where: { order_id: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    if (parentIds.length) await prisma.parentOrder.deleteMany({ where: { id: { in: parentIds } } });
    await prisma.cartItem.deleteMany({ where: { user_id: { in: userIds } } });
    for (const [id, qty] of opening) {
      await prisma.productVariant.update({ where: { id }, data: { stock_quantity: qty } });
    }
    await prisma.salesRep.deleteMany({ where: { user_id: { in: userIds } } });
    await prisma.address.deleteMany({ where: { user_id: { in: userIds } } });
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
    server.close();
  }

  console.log(`\n${passed}/${passed + failed} passed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
