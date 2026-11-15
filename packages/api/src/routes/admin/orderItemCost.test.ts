// ─── Integration test · an order line's buying price ────
//
// Run:  cd packages/api && npm run test:order-item-cost
//
// 2026-10-27, the user: "on each order we should be able to edit the buying
// price... It will be done by the admin and not the reps".
//
// What has to hold:
//   · a line copies its size's buying price when it is made — the rep/staff
//     builder, the customer's checkout, a line an edit adds — and a swap to
//     another size takes that size's;
//   · the admin order page reads it and sets it per line; that changes the
//     order only, never the product, and is refused for a line of another
//     order, a negative figure or a repeated line;
//   · the rep and the customer never get the key, and the rep cannot call
//     the admin route.
//
// Makes its own product, rep and clients, and deletes them afterwards.
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
const leaks = (body: unknown) => JSON.stringify(body ?? null).includes('unit_cost');
const costOf = async (itemId: string) => Number((await prisma.orderItem.findUnique({ where: { id: itemId }, select: { unit_cost: true } }))?.unit_cost);

async function main() {
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

  const userIds: string[] = [];
  let productId: string | null = null;

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
    const category = await prisma.category.findFirst({ where: { is_active: true, approval_status: 'approved' }, select: { id: true } });
    const admin = await prisma.admin.findFirst({ where: { role: 'super_admin' }, select: { id: true, email: true, role: true } });
    if (!category || !admin) { console.log('  SKIP  need an approved category and a super admin'); return; }
    const adminToken = generateAdminAccessToken({ adminId: admin.id, email: admin.email, role: admin.role });

    // A Cesto product with three sizes and three buying prices.
    const product = await prisma.product.create({
      data: {
        name_es: `QA LineCost ${stamp}`, name_en: `QA LineCost ${stamp}`, category_id: category.id, is_active: true,
        variants: { create: [
          { name_es: 'A', name_en: 'A', price: 5, cost_price: 1.8, stock_quantity: 100, is_default: true },
          { name_es: 'B', name_en: 'B', price: 4, cost_price: 0.9, stock_quantity: 100 },
          { name_es: 'C', name_en: 'C', price: 9, cost_price: 4, stock_quantity: 100 },
        ] },
      },
      select: { id: true, variants: { select: { id: true, name_es: true } } },
    });
    productId = product.id;
    const vid = (n: string) => product.variants.find((v) => v.name_es === n)!.id;

    // A rep who sells Cesto's own, and their client.
    const repEmail = `qa.linecost.rep.${stamp}@cesto.test`;
    const granted = await call('/api/admin/sales-reps', { method: 'POST', token: adminToken, body: { name: 'QA LineCost Rep', email: repEmail, send_credentials: false, store_ids: ['cesto'] } });
    const repId = granted.body.data?.user_id as string;
    if (repId) userIds.push(repId);
    const repToken = generateAccessToken({ userId: repId, email: repEmail });
    const client = await prisma.user.create({ data: { name: `QA LineCost Client ${stamp}`, email: `qa.linecost.client.${stamp}@cesto.test`, created_by_sales_rep_id: repId }, select: { id: true } });
    userIds.push(client.id);
    const addr = await prisma.address.create({ data: { user_id: client.id, contact_name: 'QA', contact_phone: '600000011', street_line_1: 'C/ Coste 2', postcode: '28016', city: 'Madrid', province: 'Madrid' }, select: { id: true } });

    // ─── 1. The rep's builder copies the size's ─────────────
    const built = await call('/api/sales/orders', { method: 'POST', token: repToken, body: { user_id: client.id, address_id: addr.id, delivery_fee: 0, items: [{ variant_id: vid('A'), quantity: 3 }] } });
    const orderId = built.body.data?.order?.id as string;
    check('a rep builds an order', built.status === 201 && !!orderId, { status: built.status, error: built.body.error });
    const lineA = await prisma.orderItem.findFirst({ where: { order_id: orderId, variant_id: vid('A') }, select: { id: true } });
    check('...its line copied the size\'s buying price (1.80)', !!lineA && (await costOf(lineA.id)) === 1.8);
    check('...and the rep\'s response does not carry it', !leaks(built.body));
    const repView = await call(`/api/sales/orders/${orderId}`, { token: repToken });
    check('the rep\'s order page: no buying price', repView.status === 200 && !leaks(repView.body));

    // ─── 2. The admin reads and sets it ─────────────────────
    const adminView = await call(`/api/admin/orders/${orderId}`, { token: adminToken });
    const adminLine = (adminView.body.data?.items ?? []).find((i: { id: string }) => i.id === lineA!.id);
    check('the admin\'s order page carries it per line', adminLine?.unit_cost === 1.8, adminLine?.unit_cost);
    const set = await call(`/api/admin/orders/${orderId}/item-costs`, { method: 'PUT', token: adminToken, body: { items: [{ order_item_id: lineA!.id, unit_cost: 2.25 }] } });
    check('the admin sets it to 2.25', set.status === 200 && set.body.data?.items?.[0]?.unit_cost === '2.25' && (await costOf(lineA!.id)) === 2.25, { status: set.status, error: set.body.error });
    const product1 = await prisma.productVariant.findUnique({ where: { id: vid('A') }, select: { cost_price: true } });
    check('...and the size takes it too: the product is 2.25', Number(product1?.cost_price) === 2.25 && set.body.data?.products?.[0]?.cost_price === '2.25', { product: product1?.cost_price, products: set.body.data?.products });
    const zero = await call(`/api/admin/orders/${orderId}/item-costs`, { method: 'PUT', token: adminToken, body: { items: [{ order_item_id: lineA!.id, unit_cost: 0 }] } });
    const product0 = await prisma.productVariant.findUnique({ where: { id: vid('A') }, select: { cost_price: true } });
    check('a line cleared to 0 leaves the product\'s 2.25 alone', zero.status === 200 && (await costOf(lineA!.id)) === 0 && Number(product0?.cost_price) === 2.25, { status: zero.status, product: product0?.cost_price });
    await call(`/api/admin/orders/${orderId}/item-costs`, { method: 'PUT', token: adminToken, body: { items: [{ order_item_id: lineA!.id, unit_cost: 2.25 }] } });
    const neg = await call(`/api/admin/orders/${orderId}/item-costs`, { method: 'PUT', token: adminToken, body: { items: [{ order_item_id: lineA!.id, unit_cost: -1 }] } });
    const twice = await call(`/api/admin/orders/${orderId}/item-costs`, { method: 'PUT', token: adminToken, body: { items: [{ order_item_id: lineA!.id, unit_cost: 1 }, { order_item_id: lineA!.id, unit_cost: 2 }] } });
    check('a negative figure, or a line listed twice, is refused', neg.status === 422 && twice.status === 422, [neg.status, twice.status]);
    const byRep = await call(`/api/admin/orders/${orderId}/item-costs`, { method: 'PUT', token: repToken, body: { items: [{ order_item_id: lineA!.id, unit_cost: 9 }] } });
    check('a rep cannot reach the admin route', byRep.status === 401 || byRep.status === 403, byRep.status);
    check('...and it stays 2.25', (await costOf(lineA!.id)) === 2.25);

    // ─── 3. Edits ───────────────────────────────────────────
    const addB = await call(`/api/sales/orders/${orderId}/items`, { method: 'PUT', token: repToken, body: { operations: [{ action: 'add', new_variant_id: vid('B'), new_quantity: 2 }] } });
    const lineB = await prisma.orderItem.findFirst({ where: { order_id: orderId, variant_id: vid('B') }, select: { id: true } });
    check('an edit that adds a size: the new line copies its buying price (0.90)', addB.status === 200 && !!lineB && (await costOf(lineB.id)) === 0.9, { status: addB.status, error: addB.body.error });
    check('...the line edited before keeps its 2.25', (await costOf(lineA!.id)) === 2.25);
    const qty = await call(`/api/sales/orders/${orderId}/items`, { method: 'PUT', token: repToken, body: { operations: [{ action: 'update_qty', order_item_id: lineA!.id, new_quantity: 5 }] } });
    check('a quantity change keeps the line\'s buying price', qty.status === 200 && (await costOf(lineA!.id)) === 2.25, { status: qty.status, error: qty.body.error });
    const swap = await call(`/api/sales/orders/${orderId}/items`, { method: 'PUT', token: repToken, body: { operations: [{ action: 'replace', order_item_id: lineB!.id, new_variant_id: vid('C') }] } });
    check('a swap to another size takes that size\'s buying price (4.00)', swap.status === 200 && (await costOf(lineB!.id)) === 4, { status: swap.status, error: swap.body.error, cost: await costOf(lineB!.id) });
    check('...and the rep\'s edit responses never carried it', !leaks(addB.body) && !leaks(qty.body) && !leaks(swap.body));

    // ─── 4. The customer's checkout ─────────────────────────
    const shopper = await prisma.user.create({ data: { name: `QA LineCost Shopper ${stamp}`, email: `qa.linecost.shop.${stamp}@cesto.test` }, select: { id: true, email: true } });
    userIds.push(shopper.id);
    const shopperToken = generateAccessToken({ userId: shopper.id, email: shopper.email ?? undefined });
    const shopAddr = await prisma.address.create({ data: { user_id: shopper.id, contact_name: 'QA', contact_phone: '600000012', street_line_1: 'C/ Coste 3', postcode: '28016', city: 'Madrid', province: 'Madrid' }, select: { id: true } });
    await call('/api/cart', { method: 'PUT', token: shopperToken, body: { items: [{ productId: product.id, variantId: vid('C'), quantity: 2 }] } });
    const placed = await call('/api/orders', { method: 'POST', token: shopperToken, body: { addressId: shopAddr.id, paymentMethod: 'cod' } });
    const shopLine = await prisma.orderItem.findFirst({ where: { order: { user_id: shopper.id }, variant_id: vid('C') }, select: { id: true, order_id: true } });
    check('checkout: the customer\'s line copied the size\'s buying price (4.00)', placed.status === 201 && !!shopLine && (await costOf(shopLine.id)) === 4, { status: placed.status, error: placed.body.error });
    check('...and nothing the customer gets back carries it', !leaks(placed.body));
    if (shopLine) {
      const mine = await call(`/api/orders/${shopLine.order_id}`, { token: shopperToken });
      check('the customer\'s order page: no buying price', mine.status === 200 && !leaks(mine.body), mine.status);
      const other = await call(`/api/admin/orders/${orderId}/item-costs`, { method: 'PUT', token: adminToken, body: { items: [{ order_item_id: shopLine.id, unit_cost: 1 }] } });
      check('the admin route refuses a line of another order', other.status === 422 && (await costOf(shopLine.id)) === 4, other.status);
    }
  } finally {
    if (userIds.length) {
      const orders = await prisma.order.findMany({ where: { user_id: { in: userIds } }, select: { id: true, parent_order_id: true } });
      const oIds = orders.map((o) => o.id);
      await prisma.orderEditLog.deleteMany({ where: { order_id: { in: oIds } } }).catch(() => {});
      await prisma.orderItem.deleteMany({ where: { order_id: { in: oIds } } });
      await prisma.orderIdempotency.deleteMany({ where: { order_id: { in: oIds } } }).catch(() => {});
      await prisma.order.deleteMany({ where: { id: { in: oIds } } });
      await prisma.parentOrder.deleteMany({ where: { user_id: { in: userIds } } }).catch(() => {});
      await prisma.cartItem.deleteMany({ where: { user_id: { in: userIds } } }).catch(() => {});
      await prisma.notification.deleteMany({ where: { user_id: { in: userIds } } }).catch(() => {});
      await prisma.address.deleteMany({ where: { user_id: { in: userIds } } });
      await prisma.salesRepProduct.deleteMany({ where: { sales_rep_id: { in: userIds } } });
      await prisma.salesRep.deleteMany({ where: { user_id: { in: userIds } } });
      await prisma.userRefreshToken.deleteMany({ where: { user_id: { in: userIds } } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch((e) => console.log('  (cleanup: users)', e.message));
    }
    if (productId) {
      await prisma.cartItem.deleteMany({ where: { variant: { product_id: productId } } }).catch(() => {});
      await prisma.productVariant.deleteMany({ where: { product_id: productId } });
      await prisma.product.delete({ where: { id: productId } });
    }
    server.close();
    await prisma.$disconnect();
    console.log(`\n${passed}/${passed + failed} passed`);
    process.exit(failed === 0 ? 0 : 1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

