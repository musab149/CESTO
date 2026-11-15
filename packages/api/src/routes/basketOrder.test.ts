// ─── Contract test · the basket does not reshuffle ─────────────────────────
//
// Run:  cd packages/api && npm run test:basket-order
//
// `include: { items: true }` has no order, so the rows come back in whatever
// sequence Postgres finds them in — and an UPDATE writes a new tuple, which
// can put the line somebody just edited somewhere else in the list. The screens
// built on that payload are a 34-line basket in a 216px window with clipped
// names, and three of its columns are per-line controls: a quantity stepper, a
// discount field and a bin.
//
// A list that renumbers itself between two loads of the same order is how a
// discount ends up on the line above the one it was meant for, and how a line
// somebody is watching appears to "lose" its picture — it is a different line.
//
// So both order-detail routes sort by id. Arbitrary, but the SAME arbitrary
// every time, which is the only property that matters here. OrderItem has no
// created_at to sort by instead.
import http from 'http';
import app from '../server';
import prisma from '../lib/prisma';
import { generateAdminAccessToken, generateAccessToken } from '../lib/jwt';
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
/** Enough lines that a heap order and a sorted order are not the same by luck. */
const LINES = 8;

const ascending = (ids: string[]) =>
  ids.every((id, i) => i === 0 || ids[i - 1] < id);

async function main() {
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

  const userIds: string[] = [];
  const orderIds: string[] = [];
  const taken = new Map<string, number>();

  const call = async (path: string, init: { method?: string; body?: unknown; token: string }) => {
    const res = await fetch(`${base}${path}`, {
      method: init.method ?? 'GET',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${init.token}` },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: res.status, body: await res.json() as { success: boolean; error?: string; data?: any } };
  };

  try {
    // A rep sells from one shop (lib/repStore): the products come from one, and the rep is given it.
    const shopId = await busiestShop({ stock_quantity: { gte: 4 } });
    const variants = await prisma.productVariant.findMany({
      where: { is_active: true, product: { is_active: true, store_id: shopId }, stock_quantity: { gte: 4 } },
      select: { id: true }, take: LINES,
    });
    if (variants.length < 4) {
      console.log(`  SKIP  only ${variants.length} variants with stock to work with`);
      return;
    }

    const admin = await prisma.admin.findFirst({ select: { id: true, email: true, role: true } });
    if (!admin) { console.log('  SKIP  no admin row to act as'); return; }
    const adminToken = generateAdminAccessToken({
      adminId: admin.id, email: admin.email, role: admin.role,
    });

    const rep = await prisma.user.create({
      data: { name: `QA Order ${stamp}`, email: `qa.order.${stamp}@cesto.test` },
    });
    userIds.push(rep.id);
    await prisma.salesRep.create({ data: { user_id: rep.id, is_active: true, ...repShop(shopId) } });
    const repToken = generateAccessToken({ userId: rep.id, email: rep.email ?? undefined });

    const client = await prisma.user.create({
      data: {
        name: `QA OrderClient ${stamp}`, email: `qa.orderclient.${stamp}@cesto.test`,
        created_by_sales_rep_id: rep.id,
      },
    });
    userIds.push(client.id);
    const address = await prisma.address.create({
      data: {
        user_id: client.id, contact_name: 'QA', contact_phone: '600000004',
        street_line_1: 'C/ Orden 1', postcode: '28016', city: 'Madrid', province: 'Madrid',
      },
      select: { id: true },
    });

    // Built through the REP's route so one order can answer for both detail
    // endpoints: the rep's own, and admin's view of the same rows.
    const made = await call('/api/sales/orders', {
      method: 'POST', token: repToken,
      body: {
        user_id: client.id, address_id: address.id, delivery_fee: 0,
        items: variants.map((v) => ({ variant_id: v.id, quantity: 1 })),
      },
    });
    const orderId = made.body.data?.order?.id as string | undefined;
    if (!orderId) { console.log('  ABORT  could not create the order', made.body.error); return; }
    orderIds.push(orderId);
    for (const v of variants) taken.set(v.id, 1);

    const idsFrom = (body: { data?: { items?: Array<{ id: string }> } }) =>
      (body.data?.items ?? []).map((i) => i.id);

    // ─── 1. Both routes answer in a defined order ────────────
    const adminFirst = idsFrom((await call(`/api/admin/orders/${orderId}`, { token: adminToken })).body);
    const repFirst = idsFrom((await call(`/api/sales/orders/${orderId}`, { token: repToken })).body);

    check(`the order came back with all ${variants.length} lines`,
      adminFirst.length === variants.length, { got: adminFirst.length });
    check('ADMIN serves the lines in a defined order', ascending(adminFirst),
      adminFirst.map((i) => i.slice(0, 8)));
    check('THE REP serves the lines in a defined order', ascending(repFirst),
      repFirst.map((i) => i.slice(0, 8)));
    check('...and both screens see the same basket, in the same sequence',
      JSON.stringify(adminFirst) === JSON.stringify(repFirst));

    // ─── 2. An edit does not move anything ───────────────────
    //
    // The edit is a discount on a line in the MIDDLE, which is the case that
    // bit: its row is rewritten, so without an order it can resurface at the
    // end of the list while every other line stays put.
    const middle = adminFirst[Math.floor(adminFirst.length / 2)];
    const edited = await call(`/api/sales/orders/${orderId}/items`, {
      method: 'PUT', token: repToken,
      body: { operations: [{ action: 'set_discount', order_item_id: middle, discount_amount: 1 }] },
    });
    check('a line in the middle takes a discount', edited.status === 200,
      { status: edited.status, error: edited.body.error });

    const adminAfter = idsFrom((await call(`/api/admin/orders/${orderId}`, { token: adminToken })).body);
    const repAfter = idsFrom((await call(`/api/sales/orders/${orderId}`, { token: repToken })).body);

    check('THE BASKET IS IN THE SAME SEQUENCE AFTER THE EDIT (admin)',
      JSON.stringify(adminAfter) === JSON.stringify(adminFirst),
      { before: adminFirst.map((i) => i.slice(0, 8)), after: adminAfter.map((i) => i.slice(0, 8)) });
    check('...and for the rep',
      JSON.stringify(repAfter) === JSON.stringify(repFirst),
      { before: repFirst.map((i) => i.slice(0, 8)), after: repAfter.map((i) => i.slice(0, 8)) });
    check('...and the edited line is still where it was',
      adminAfter.indexOf(middle) === adminFirst.indexOf(middle),
      { was: adminFirst.indexOf(middle), is: adminAfter.indexOf(middle) });

    // ─── 3. A quantity change does not either ────────────────
    const items = await prisma.orderItem.findMany({
      where: { order_id: orderId }, select: { id: true },
    });
    const another = items.map((i) => i.id).sort()[1];
    await call(`/api/sales/orders/${orderId}/items`, {
      method: 'PUT', token: repToken,
      body: { operations: [{ action: 'update_qty', order_item_id: another, new_quantity: 3 }] },
    });
    const afterQty = idsFrom((await call(`/api/admin/orders/${orderId}`, { token: adminToken })).body);
    check('a quantity change leaves the sequence alone too',
      JSON.stringify(afterQty) === JSON.stringify(adminFirst),
      { before: adminFirst.map((i) => i.slice(0, 8)), after: afterQty.map((i) => i.slice(0, 8)) });
    taken.set(
      (await prisma.orderItem.findUnique({ where: { id: another }, select: { variant_id: true } }))!.variant_id!,
      3,
    );

  } finally {
    if (orderIds.length) {
      await prisma.orderEditLog.deleteMany({ where: { order_id: { in: orderIds } } });
      await prisma.orderItem.deleteMany({ where: { order_id: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    for (const [variantId, units] of taken) {
      await prisma.productVariant.update({
        where: { id: variantId }, data: { stock_quantity: { increment: units } },
      });
    }
    if (userIds.length) {
      await prisma.address.deleteMany({ where: { user_id: { in: userIds } } });
      await prisma.salesRep.deleteMany({ where: { user_id: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
    server.close();
  }

  console.log(`\n${passed}/${passed + failed} passed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
