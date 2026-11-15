// ─── Integration test · GET /api/orders?active=1 ────────────────────────────
//
// Run:  cd packages/api && npm run test:orders-active
//
// The business home's order bar lists the buyer's orders still on their way
// and polls for them (2026-11-01). `active=1` asks for exactly those — solo
// orders by their own status, split purchases by the status derived from
// their parts — so an older order still in progress isn't lost behind newer
// ones, and nothing delivered, cancelled, partly completed or held as a draft
// comes back. Without the param, and with `status`, nothing changes.
//
// Goes through the real route over HTTP. Creates its own buyer and orders
// and removes them in a finally.

import http from 'http';
import { OrderStatus, Prisma } from '@prisma/client';
import app from '../server';
import prisma from '../lib/prisma';
import { generateAccessToken } from '../lib/jwt';
import { generateOrderNumber } from '../lib/pagination';
import { generateParentOrderNumber } from '../lib/parentOrder';

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
const LIVE = ['pending', 'confirmed', 'preparing', 'on_the_way'];

async function main() {
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

  const userIds: string[] = [];
  const orderIds: string[] = [];
  const parentIds: string[] = [];

  type Row = { id: string; order_number: string; status: string; __shape: string };
  const list = async (query: string, token: string) => {
    const res = await fetch(`${base}/api/orders${query}`, { headers: { Authorization: `Bearer ${token}` } });
    const body = await res.json().catch(() => null) as { data?: { items: Row[]; total: number } } | null;
    return { status: res.status, items: body?.data?.items ?? [], total: body?.data?.total ?? -1 };
  };

  try {
    // ─── Fixtures: one buyer, every status, three split purchases ───
    const email = `qa.active.${stamp}@cesto.test`;
    const buyer = await prisma.user.create({ data: { name: `QA Active ${stamp}`, email }, select: { id: true } });
    userIds.push(buyer.id);
    const token = generateAccessToken({ userId: buyer.id, email });
    const address = await prisma.address.create({
      data: { user_id: buyer.id, contact_name: 'QA', contact_phone: '611223344', street_line_1: `Calle QA ${stamp}`, postcode: '28016', city: 'Madrid', province: 'Madrid' },
      select: { id: true },
    });
    const snapshot = { contact_name: 'QA', contact_phone: '611223344', street_line_1: `Calle QA ${stamp}`, postcode: '28016', city: 'Madrid' };
    const money = { subtotal: new Prisma.Decimal('10.00'), delivery_fee: new Prisma.Decimal(0), total: new Prisma.Decimal('10.00') };
    const solo = async (status: OrderStatus, parentId?: string) => {
      const o = await prisma.order.create({
        data: {
          order_number: generateOrderNumber(), user_id: buyer.id, address_id: address.id, address_snapshot: snapshot,
          status, payment_method: 'cod', ...money, ...(parentId ? { parent_order_id: parentId } : {}),
        },
        select: { id: true, order_number: true },
      });
      orderIds.push(o.id);
      return o;
    };
    const split = async (parts: OrderStatus[]) => {
      const p = await prisma.parentOrder.create({
        data: {
          order_number: generateParentOrderNumber(), user_id: buyer.id, address_id: address.id, payment_method: 'cod', address_snapshot: snapshot,
          subtotal: new Prisma.Decimal('20.00'), delivery_fee_total: new Prisma.Decimal(0), total: new Prisma.Decimal('20.00'),
        },
        select: { id: true, order_number: true },
      });
      parentIds.push(p.id);
      for (const s of parts) await solo(s, p.id);
      return p;
    };

    const live = await Promise.all((['pending', 'confirmed', 'preparing', 'on_the_way'] as OrderStatus[]).map((s) => solo(s)));
    const done = await Promise.all((['delivered', 'cancelled', 'draft'] as OrderStatus[]).map((s) => solo(s)));
    const liveSplit = await split(['delivered', 'preparing']); // → preparing
    const doneSplit = await split(['delivered', 'delivered']); // → delivered
    const mixedSplit = await split(['delivered', 'cancelled']); // → partially_completed

    // ─── 1. active=1: exactly the orders on their way ───
    const a = await list('?active=1&limit=50', token);
    const got = new Set(a.items.map((o) => o.order_number));
    check('200', a.status === 200, a.status);
    check('every solo order on its way is there', live.every((o) => got.has(o.order_number)), [...got]);
    check('…and the split purchase still on its way', got.has(liveSplit.order_number), [...got]);
    check('nothing delivered, cancelled or held as a draft', done.every((o) => !got.has(o.order_number)), [...got]);
    check('no split purchase that is delivered or partly completed', !got.has(doneSplit.order_number) && !got.has(mixedSplit.order_number), [...got]);
    check('every row it returns is in progress', a.items.every((o) => LIVE.includes(o.status)), a.items.map((o) => o.status));
    check('the parts of a split purchase never show on their own', a.items.every((o) => !orderIds.includes(o.id) || live.some((l) => l.order_number === o.order_number)), a.items.map((o) => o.order_number));
    check('the total counts only those (4 solo + 1 split)', a.total === 5 && a.items.length === 5, { total: a.total, n: a.items.length });

    // ─── 2. without it, the list is what it always was ───
    const all = await list('?limit=50', token);
    check('without active: every order (7 solo + 3 splits)', all.items.length === 10 && all.total === 10, { n: all.items.length, total: all.total });

    // ─── 3. status wins over active ───
    const delivered = await list('?status=delivered&active=1&limit=50', token);
    check('status=delivered with active=1 lists the delivered ones (status wins)',
      delivered.items.length === 2 && delivered.items.every((o) => o.status === 'delivered'),
      delivered.items.map((o) => `${o.order_number}:${o.status}`));

    // ─── 4. another buyer's orders never leak in ───
    const otherEmail = `qa.active.other.${stamp}@cesto.test`;
    const other = await prisma.user.create({ data: { name: `QA Active Other ${stamp}`, email: otherEmail }, select: { id: true } });
    userIds.push(other.id);
    const theirs = await list('?active=1&limit=50', generateAccessToken({ userId: other.id, email: otherEmail }));
    check("another buyer sees none of these", theirs.status === 200 && theirs.items.length === 0, theirs.items.length);
  } finally {
    if (orderIds.length) await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    if (parentIds.length) await prisma.parentOrder.deleteMany({ where: { id: { in: parentIds } } });
    if (userIds.length) {
      await prisma.address.deleteMany({ where: { user_id: { in: userIds } } });
      await prisma.userRefreshToken.deleteMany({ where: { user_id: { in: userIds } } }).catch(() => {});
      await prisma.notification.deleteMany({ where: { user_id: { in: userIds } } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    server.close();
    await prisma.$disconnect();
    console.log(`\n${passed}/${passed + failed} passed`);
    process.exit(failed === 0 ? 0 : 1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
