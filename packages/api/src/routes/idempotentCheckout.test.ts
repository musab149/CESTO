// ─── Integration test · one key, one order ─────────────────────────────────
//
// Run:  cd packages/api && npm run test:idempotent-checkout
//
// Duplicate orders reached the shop often enough to be reported. The button
// guard in the apps stops a second PRESS; this is the other half, and it is
// the half that matters for everything the UI cannot see:
//
//   · a request that succeeded and whose response was lost,
//   · a reloaded tab replaying the same action,
//   · two devices, or a flaky connection resending.
//
// The ordering of the replay check is itself load-bearing and has its own
// case below: the first request CLEARS the cart, so a retry arrives at an
// empty one. Before this, that retry was told "Your cart is empty" — about an
// order that had just been placed successfully.
//
// Goes through the real route over HTTP. Creates its own fixtures and removes
// them in a finally.
import http from 'http';
import app from '../server';
import prisma from '../lib/prisma';
import { generateAccessToken } from '../lib/jwt';

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
  const orderIds: string[] = [];
  const opening = new Map<string, number>();

  const call = async (path: string, init: { method?: string; body?: unknown; token?: string; key?: string } = {}) => {
    const res = await fetch(`${base}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
        ...(init.key ? { 'Idempotency-Key': init.key } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: res.status, body: await res.json() as { success: boolean; error?: string; data?: any } };
  };

  try {
    const variants = await prisma.productVariant.findMany({
      where: { is_active: true, product: { is_active: true }, stock_quantity: { gte: QTY * 6 } },
      select: { id: true, product_id: true, stock_quantity: true },
      take: 3,
    });
    if (variants.length < 3) {
      console.log('  SKIP  not enough stocked variants to work with');
      return;
    }
    for (const v of variants) opening.set(v.id, v.stock_quantity);

    const user = await prisma.user.create({
      data: { name: `QA Idem ${stamp}`, email: `qa.idem.${stamp}@cesto.test` },
      select: { id: true, email: true },
    });
    userIds.push(user.id);
    const token = generateAccessToken({ userId: user.id, email: user.email ?? undefined });

    const address = await prisma.address.create({
      data: {
        user_id: user.id, contact_name: 'QA', contact_phone: '600000000',
        street_line_1: 'C/ Test 1', postcode: '28016', city: 'Madrid', province: 'Madrid',
      },
      select: { id: true },
    });

    const fillCart = () => call('/api/cart', {
      method: 'PUT', token,
      body: { items: variants.map((v) => ({ productId: v.product_id, variantId: v.id, quantity: QTY })) },
    });
    const place = (key?: string) => call('/api/orders', {
      method: 'POST', token, key,
      body: { addressId: address.id, paymentMethod: 'cod' },
    });
    const countOrders = () => prisma.order.count({ where: { user_id: user.id } });
    const stockOf = async (id: string) =>
      (await prisma.productVariant.findUnique({ where: { id }, select: { stock_quantity: true } }))?.stock_quantity ?? -1;

    // ─── 1. The same key twice is ONE order ──────────────────
    await fillCart();
    const before = await stockOf(variants[0].id);

    const first = await place('attempt-a');
    check('the first request places the order', first.status === 201,
      { status: first.status, error: first.body.error });
    if (first.body.data?.id) orderIds.push(first.body.data.id);

    const again = await place('attempt-a');
    check('...and the SAME key returns it rather than placing another',
      again.status === 200 && again.body.data?.id === first.body.data?.id,
      { status: again.status, firstId: first.body.data?.id, againId: again.body.data?.id });
    check('...with exactly one order on the account',
      await countOrders() === 1, { orders: await countOrders() });

    const after = await stockOf(variants[0].id);
    check('...and the stock moved ONCE, not twice',
      after === before - QTY, { before, after, expected: before - QTY });

    // ─── 2. The replay beats the empty-cart check ────────────
    //
    // The whole reason the lookup happens before the cart is read. The first
    // request emptied it, so without that ordering this retry is told the
    // cart is empty — about an order that exists.
    check('...even though the first request emptied the cart',
      again.body.data?.id === first.body.data?.id && (again.body.error ?? null) === null,
      { error: again.body.error });

    // ─── 3. A DIFFERENT key is a different order ─────────────
    //
    // The guard must not become "this customer may only ever order once".
    await fillCart();
    const second = await place('attempt-b');
    check('a new key places a genuinely new order', second.status === 201,
      { status: second.status, error: second.body.error });
    if (second.body.data?.id) orderIds.push(second.body.data.id);
    check('...which is not the first one', second.body.data?.id !== first.body.data?.id);
    check('...making two orders in total', await countOrders() === 2,
      { orders: await countOrders() });

    // ─── 4. No key at all behaves exactly as before ──────────
    //
    // An older web or mobile bundle sends no header, and frontends deploy
    // separately from this. It must still be able to place an order.
    await fillCart();
    const unkeyed = await place();
    check('a request with NO key still places an order', unkeyed.status === 201,
      { status: unkeyed.status, error: unkeyed.body.error });
    if (unkeyed.body.data?.id) orderIds.push(unkeyed.body.data.id);
    check('...and three orders exist', await countOrders() === 3,
      { orders: await countOrders() });

    // ─── 5. One key belongs to ONE account ───────────────────
    //
    // The key is generated by the client, so two customers can produce the
    // same one. Keyed by account, a collision must not hand over somebody
    // else's order — the worst failure this table could have.
    const other = await prisma.user.create({
      data: { name: `QA Idem B ${stamp}`, email: `qa.idem.b.${stamp}@cesto.test` },
      select: { id: true, email: true },
    });
    userIds.push(other.id);
    const otherToken = generateAccessToken({ userId: other.id, email: other.email ?? undefined });
    const otherAddress = await prisma.address.create({
      data: {
        user_id: other.id, contact_name: 'QA B', contact_phone: '600000001',
        street_line_1: 'C/ Test 2', postcode: '28016', city: 'Madrid', province: 'Madrid',
      },
      select: { id: true },
    });
    await call('/api/cart', {
      method: 'PUT', token: otherToken,
      body: { items: [{ productId: variants[0].product_id, variantId: variants[0].id, quantity: 1 }] },
    });
    const otherOrder = await call('/api/orders', {
      method: 'POST', token: otherToken, key: 'attempt-a',
      body: { addressId: otherAddress.id, paymentMethod: 'cod' },
    });
    check('another customer reusing the same key gets their OWN new order',
      otherOrder.status === 201 && otherOrder.body.data?.id !== first.body.data?.id,
      { status: otherOrder.status, id: otherOrder.body.data?.id, firstId: first.body.data?.id });
    if (otherOrder.body.data?.id) orderIds.push(otherOrder.body.data.id);

  } finally {
    if (orderIds.length) {
      await prisma.orderIdempotency.deleteMany({ where: { order_id: { in: orderIds } } });
      await prisma.orderItem.deleteMany({ where: { order_id: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    for (const [id, was] of opening) {
      await prisma.productVariant.update({ where: { id }, data: { stock_quantity: was } }).catch(() => {});
    }
    if (userIds.length) {
      await prisma.orderIdempotency.deleteMany({ where: { user_id: { in: userIds } } });
      await prisma.cartItem.deleteMany({ where: { user_id: { in: userIds } } });
      await prisma.address.deleteMany({ where: { user_id: { in: userIds } } });
      await prisma.userRefreshToken.deleteMany({ where: { user_id: { in: userIds } } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
    server.close();
  }

  console.log(`\n${passed}/${passed + failed} passed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
