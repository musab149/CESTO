// ─── Integration test · one purchase counts as one ─────────────────────────
//
// Run:  cd packages/api && npm run test:purchase-count
//
// A split checkout is ONE purchase stored as several Order rows: a ParentOrder
// plus a sub-order per shop. Every screen that says "orders" to a human means
// purchases, and `_count.orders` — a plain Prisma relation count — means rows.
//
// Reported from production: a customer with two purchases, one of them split,
// showed as 7. The detail page had grouped correctly for a while; the customer
// LIST and the B2B directory were still counting rows, which is the number
// somebody reads as "how many times has this person ordered".
//
// So this asserts the two numbers against a customer built to have both: one
// ordinary order and one split purchase. If they ever collapse into the same
// value the fixture is wrong, and the last case says so.
//
// Goes through the real routes over HTTP. Creates its own fixtures and removes
// them in a finally.
import http from 'http';
import app from '../../server';
import prisma from '../../lib/prisma';
import { Prisma } from '@prisma/client';
import { generateAdminAccessToken } from '../../lib/jwt';
import { generateOrderNumber } from '../../lib/pagination';
import { generateParentOrderNumber } from '../../lib/parentOrder';

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

/** Sub-orders in the split purchase. Three, so "rows" and "purchases" cannot
 *  coincide by accident at two. */
const PARTS = 3;

async function main() {
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

  const userIds: string[] = [];
  const orderIds: string[] = [];
  const parentIds: string[] = [];

  const call = async (path: string, token: string) => {
    const res = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: res.status, body: await res.json() as { success: boolean; error?: string; data?: any } };
  };

  try {
    const admin = await prisma.admin.findFirst({ select: { id: true, email: true, role: true } });
    if (!admin) { console.log('  SKIP  no admin row to act as'); return; }
    const token = generateAdminAccessToken({ adminId: admin.id, email: admin.email, role: admin.role });

    const user = await prisma.user.create({
      data: { name: `QA Purchases ${stamp}`, email: `qa.purchases.${stamp}@cesto.test` },
      select: { id: true },
    });
    userIds.push(user.id);

    const address = await prisma.address.create({
      data: {
        user_id: user.id, contact_name: 'QA', contact_phone: '600000000',
        street_line_1: 'C/ Test 1', postcode: '28016', city: 'Madrid', province: 'Madrid',
      },
      select: { id: true },
    });

    const money = {
      address_snapshot: {},
      subtotal: new Prisma.Decimal('10.00'),
      delivery_fee: new Prisma.Decimal(0),
      total: new Prisma.Decimal('10.00'),
    };

    // ─── Purchase 1: an ordinary order ───────────────────────
    const plain = await prisma.order.create({
      data: {
        order_number: generateOrderNumber(),
        user_id: user.id, address_id: address.id, status: 'pending',
        payment_method: 'cod', ...money,
      },
      select: { id: true },
    });
    orderIds.push(plain.id);

    // ─── Purchase 2: one basket, split across shops ──────────
    const parent = await prisma.parentOrder.create({
      data: {
        order_number: generateParentOrderNumber(),
        user_id: user.id, address_id: address.id, payment_method: 'cod',
        address_snapshot: {},
        subtotal: new Prisma.Decimal('30.00'),
        delivery_fee_total: new Prisma.Decimal(0),
        total: new Prisma.Decimal('30.00'),
      },
      select: { id: true },
    });
    parentIds.push(parent.id);

    for (let i = 0; i < PARTS; i++) {
      const sub = await prisma.order.create({
        data: {
          order_number: generateOrderNumber(),
          user_id: user.id, address_id: address.id, status: 'pending',
          payment_method: 'cod', parent_order_id: parent.id, ...money,
        },
        select: { id: true },
      });
      orderIds.push(sub.id);
    }

    const rows = 1 + PARTS;          // what a relation count sees
    const purchases = 2;             // what a person means

    // ─── The LIST, which is where this was wrong ─────────────
    const list = await call(`/api/admin/users?limit=100&q=qa.purchases.${stamp}`, token);
    check('the customer is in the list', list.status === 200 && (list.body.data?.items ?? []).length === 1,
      { status: list.status, found: (list.body.data?.items ?? []).length });
    const row = (list.body.data?.items ?? [])[0];

    check(`the list says ${purchases} purchases, not ${rows} rows`,
      row?.purchase_count === purchases,
      { purchase_count: row?.purchase_count, want: purchases });

    check('...while the row count is still reported, unchanged',
      row?._count?.orders === rows,
      { got: row?._count?.orders, want: rows });

    // ─── The DETAIL page, which already grouped ──────────────
    const detail = await call(`/api/admin/users/${user.id}`, token);
    check('the detail page agrees', detail.body.data?.stats?.orders?.purchases === purchases,
      { got: detail.body.data?.stats?.orders?.purchases, want: purchases });
    check('...and still exposes the row count beside it',
      detail.body.data?.stats?.orders?.total === rows,
      { got: detail.body.data?.stats?.orders?.total, want: rows });
    check('...and lists exactly the purchases, not the parts',
      (detail.body.data?.orders ?? []).length === purchases,
      { got: (detail.body.data?.orders ?? []).length, want: purchases });

    // ─── The grouped order list, for the same customer ───────
    const grouped = await call(`/api/admin/orders?grouped=true&userId=${user.id}&limit=50`, token);
    check('the grouped order list totals purchases too',
      grouped.body.data?.total === purchases,
      { got: grouped.body.data?.total, want: purchases });

    // ─── The fixture is actually testing something ───────────
    check('rows and purchases genuinely differ here',
      rows !== purchases, { rows, purchases });

  } finally {
    if (orderIds.length) {
      await prisma.orderItem.deleteMany({ where: { order_id: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    if (parentIds.length) await prisma.parentOrder.deleteMany({ where: { id: { in: parentIds } } });
    if (userIds.length) {
      await prisma.address.deleteMany({ where: { user_id: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
    server.close();
  }

  console.log(`\n${passed}/${passed + failed} passed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
