// ─── Integration test · one key, one order, for orders BUILT for a customer ──
//
// Run:  cd packages/api && npm run test:built-order-key
//
// Admin (POST /api/admin/orders) and a sales rep (POST /api/sales/orders)
// build orders for their clients. Their screens used to give up after 10s
// while the server could take longer, so a slow moment ended with the order
// created, the screen saying it had failed, a second press — and a second
// real order. The fix is the customer checkout's: an Idempotency-Key per
// attempt, and the same order back for a retry that carries it.
//
// What has to hold:
//   · a retry with the same key gets the SAME order back, 200 not 201, and
//     neither a second order nor a second stock move;
//   · two presses at the same moment with one key still make one order;
//   · no key behaves exactly as before — two presses, two orders;
//   · a key only replays for the side that built it.
//
// Goes through the real routes over HTTP. Creates its own fixtures and puts
// every shelf back in a finally.
import http from 'http';
import app from '../server';
import prisma from '../lib/prisma';
import { generateAccessToken, generateAdminAccessToken } from '../lib/jwt';
import { busiestShop, repShop } from '../lib/testRepShop';

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
const QTY = 2;

async function main() {
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

  const userIds: string[] = [];
  /** variant id -> stock before the test touched anything. */
  const opening = new Map<string, number>();
  let clientId: string | null = null;

  const call = async (path: string, init: { method?: string; body?: unknown; token: string; key?: string }) => {
    const res = await fetch(`${base}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${init.token}`,
        ...(init.key ? { 'Idempotency-Key': init.key } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: res.status, body: await res.json() as { success: boolean; error?: string; data?: any } };
  };

  try {
    const admin = await prisma.admin.findFirst({ select: { id: true, email: true, role: true } });
    if (!admin) { console.log('  SKIP  no admin row to act as'); return; }
    const adminToken = generateAdminAccessToken({ adminId: admin.id, email: admin.email, role: admin.role });

    // A rep sells from one shop (lib/repStore): the products come from one, and the rep is given it.
    const shopId = await busiestShop({ stock_quantity: { gte: QTY * 20 } });
    const variants = await prisma.productVariant.findMany({
      where: { is_active: true, product: { is_active: true, store_id: shopId }, stock_quantity: { gte: QTY * 20 } },
      select: { id: true, stock_quantity: true },
      take: 3,
    });
    if (variants.length < 3) { console.log('  SKIP  not enough stocked variants'); return; }
    for (const v of variants) opening.set(v.id, v.stock_quantity);

    const rep = await prisma.user.create({
      data: { name: `QA KeyRep ${stamp}`, email: `qa.keyrep.${stamp}@cesto.test` },
    });
    userIds.push(rep.id);
    const salesRep = await prisma.salesRep.create({ data: { user_id: rep.id, is_active: true, ...repShop(shopId) } });
    const repToken = generateAccessToken({ userId: rep.id, email: rep.email ?? undefined });

    const client = await prisma.user.create({
      data: {
        name: `QA KeyClient ${stamp}`, email: `qa.keyclient.${stamp}@cesto.test`,
        created_by_sales_rep_id: rep.id,
      },
    });
    userIds.push(client.id);
    clientId = client.id;
    const address = await prisma.address.create({
      data: {
        user_id: client.id, contact_name: 'QA', contact_phone: '600000002',
        street_line_1: 'C/ Clave 1', postcode: '28016', city: 'Madrid', province: 'Madrid',
      },
    });

    const body = {
      user_id: client.id,
      address_id: address.id,
      items: variants.map((v) => ({ variant_id: v.id, quantity: QTY })),
    };
    const ordersNow = () => prisma.order.count({ where: { user_id: client.id } });
    const stockTaken = async () => {
      const rows = await prisma.productVariant.findMany({
        where: { id: { in: [...opening.keys()] } }, select: { id: true, stock_quantity: true },
      });
      return rows.map((r) => opening.get(r.id)! - r.stock_quantity);
    };
    const notesNow = () => prisma.notification.count({ where: { user_id: client.id } });

    // ─── 1. The rep: a retry with the same key ──────────────
    const k1 = `rep-${stamp}-1`;
    const first = await call('/api/sales/orders', { method: 'POST', token: repToken, key: k1, body });
    check('a rep\'s keyed order is created', first.status === 201, { status: first.status, error: first.body.error });
    const firstId = first.body.data?.order?.id;
    await new Promise((r) => setTimeout(r, 300)); // let the announcement land
    const notesAfterFirst = await notesNow();

    const retry = await call('/api/sales/orders', { method: 'POST', token: repToken, key: k1, body });
    check('...a retry with the same key gets the SAME order back',
      retry.status === 200 && retry.body.data?.order?.id === firstId,
      { status: retry.status, id: retry.body.data?.order?.id, firstId });
    check('...and nothing new exists', (await ordersNow()) === 1, { orders: await ordersNow() });
    check('...stock was taken once, not twice',
      (await stockTaken()).every((t) => t === QTY), await stockTaken());
    await new Promise((r) => setTimeout(r, 300));
    check('...and the client was not told twice', (await notesNow()) === notesAfterFirst,
      { before: notesAfterFirst, after: await notesNow() });

    // ─── 2. Two presses at the same moment, one key ─────────
    const k2 = `rep-${stamp}-2`;
    const [a, b] = await Promise.all([
      call('/api/sales/orders', { method: 'POST', token: repToken, key: k2, body }),
      call('/api/sales/orders', { method: 'POST', token: repToken, key: k2, body }),
    ]);
    const ids = [a.body.data?.order?.id, b.body.data?.order?.id];
    check('two simultaneous presses with one key both succeed',
      [a.status, b.status].every((s) => s === 200 || s === 201), { a: a.status, b: b.status, ea: a.body.error, eb: b.body.error });
    check('...with the same order', ids[0] && ids[0] === ids[1], ids);
    check('...and only one of them made it', (await ordersNow()) === 2, { orders: await ordersNow() });
    check('...taking the stock once', (await stockTaken()).every((t) => t === QTY * 2), await stockTaken());

    // ─── 3. No key: exactly as before ───────────────────────
    const plain1 = await call('/api/sales/orders', { method: 'POST', token: repToken, body });
    const plain2 = await call('/api/sales/orders', { method: 'POST', token: repToken, body });
    check('without a key, two presses are two orders, as before',
      plain1.status === 201 && plain2.status === 201 && plain1.body.data?.order?.id !== plain2.body.data?.order?.id,
      { s1: plain1.status, s2: plain2.status });

    // ─── 4. Admin, same rules ───────────────────────────────
    const k3 = `admin-${stamp}-3`;
    const adminFirst = await call('/api/admin/orders', { method: 'POST', token: adminToken, key: k3, body });
    check('an admin\'s keyed order is created', adminFirst.status === 201,
      { status: adminFirst.status, error: adminFirst.body.error });
    const adminRetry = await call('/api/admin/orders', { method: 'POST', token: adminToken, key: k3, body });
    check('...and its retry comes back as that order',
      adminRetry.status === 200 && adminRetry.body.data?.order?.id === adminFirst.body.data?.order?.id,
      { status: adminRetry.status });

    // ─── 5. A key replays only for the side that built it ───
    const before = await ordersNow();
    const crossed = await call('/api/sales/orders', { method: 'POST', token: repToken, key: k3, body });
    check('a rep sending an admin order\'s key is refused, not served', crossed.status === 409,
      { status: crossed.status, error: crossed.body.error });
    check('...and nothing was created by it', (await ordersNow()) === before);

    void salesRep;
  } finally {
    if (clientId) {
      const orders = await prisma.order.findMany({ where: { user_id: clientId }, select: { id: true } });
      const orderIds = orders.map((o) => o.id);
      await prisma.orderIdempotency.deleteMany({ where: { user_id: clientId } });
      await prisma.notification.deleteMany({ where: { user_id: clientId } });
      if (orderIds.length) {
        await prisma.orderEditLog.deleteMany({ where: { order_id: { in: orderIds } } });
        await prisma.orderItem.deleteMany({ where: { order_id: { in: orderIds } } });
        await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
      }
    }
    // Every shelf back, whatever happened above.
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
