// ─── Integration test · a sales rep's earnings, order by order ──────────
//
// Run:  cd packages/api && npm run test:rep-earnings
//
// 2026-10-28, the user: "the earnings of the reps will be calculated from the
// orders. In every order we will add the expenses of that order, the net
// profit after calculation based on the commission percentage of that rep...
// Rep will not be able to see the buying prices... If any order is cancelled
// then the earnings should be reverted and recorded... the history maintained
// about owed amount and paid amount". Decisions: products − buying − expenses;
// owed once delivered AND approved by an admin; 0 at a loss; the rep sees the
// whole breakdown but no buying price (lib/repEarnings).
//
// Makes its own product, reps, clients, rider and orders, and removes them.
import http from 'http';
import { Prisma } from '@prisma/client';
import app from '../../server';
import prisma from '../../lib/prisma';
import { generateAccessToken, generateAdminAccessToken } from '../../lib/jwt';
import { figuresFor, madridDayStart } from '../../lib/repEarnings';

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
const D = (n: number | string) => new Prisma.Decimal(n);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** A buying price, or the word for it, anywhere in what a rep gets back. */
const leaksBuying = (body: unknown) => /unit_cost|"buying"|cost_price|approved_buying/.test(JSON.stringify(body ?? null));

async function main() {
  // ─── 0. The arithmetic and the calendar ───────────────────
  check('a Madrid day starts at 23:00 UTC the day before in winter', madridDayStart('2026-10-26').toISOString() === '2026-10-25T23:00:00.000Z');
  check('...at 22:00 UTC in summer', madridDayStart('2026-07-01').toISOString() === '2026-06-30T22:00:00.000Z');
  const f = figuresFor({ subtotal: D(30), items: [{ quantity: 3, unit_cost: D(4) }], expenses: [{ amount: D(5) }], pct: D(10) });
  check('10% × (30 − 3×4 − 5) = 1,30', f.earning.toFixed(2) === '1.30' && f.net.toFixed(2) === '13.00' && f.buying.toFixed(2) === '12.00', { e: f.earning, n: f.net });
  const loss = figuresFor({ subtotal: D(20), items: [{ quantity: 1, unit_cost: D(25) }], expenses: [], pct: D(10) });
  check('an order at a loss earns 0 — it takes nothing back', loss.earning.toFixed(2) === '0.00' && loss.net.toFixed(2) === '-5.00');
  check('no percentage yet: 0', figuresFor({ subtotal: D(30), items: [], expenses: [], pct: null }).earning.isZero());
  check('to the cent, half up: 12,5% × 13,33 = 1,67', figuresFor({ subtotal: D('13.33'), items: [], expenses: [], pct: D('12.5') }).earning.toFixed(2) === '1.67');

  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const userIds: string[] = [];
  const orderIds: string[] = [];
  let productId: string | null = null;
  let riderId: string | null = null;

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
    const admin = await prisma.admin.findFirst({ where: { role: 'super_admin' }, select: { id: true, email: true } });
    if (!category || !admin) { console.log('  SKIP  need an approved category and a super admin'); return; }
    const sa = generateAdminAccessToken({ adminId: admin.id, email: admin.email, role: 'super_admin' });
    const ops = generateAdminAccessToken({ adminId: admin.id, email: admin.email, role: 'ops' });

    // A Cesto product: A sells at 10 and costs 4; B sells at 20 and costs 25.
    const product = await prisma.product.create({
      data: {
        name_es: `QA Ganancias ${stamp}`, name_en: `QA Earnings ${stamp}`, category_id: category.id, is_active: true,
        variants: { create: [
          { name_es: 'A', name_en: 'A', price: 10, cost_price: 4, stock_quantity: 500, is_default: true },
          { name_es: 'B', name_en: 'B', price: 20, cost_price: 25, stock_quantity: 500 },
        ] },
      },
      select: { id: true, variants: { select: { id: true, name_es: true } } },
    });
    productId = product.id;
    const vid = (n: string) => product.variants.find((v) => v.name_es === n)!.id;

    const mkRep = async (label: string) => {
      const email = `qa.earn.${label}.${stamp}@cesto.test`;
      const g = await call('/api/admin/sales-reps', { method: 'POST', token: sa, body: { name: `QA Ganancias ${label}`, email, send_credentials: false, store_ids: ['cesto'] } });
      const id = g.body.data?.user_id as string;
      userIds.push(id);
      return { id, token: generateAccessToken({ userId: id, email }) };
    };
    const rep = await mkRep('a');
    const other = await mkRep('b');
    const client = await prisma.user.create({ data: { name: `QA Ganancias Cliente ${stamp}`, email: `qa.earn.client.${stamp}@cesto.test`, created_by_sales_rep_id: rep.id }, select: { id: true } });
    userIds.push(client.id);
    const addr = await prisma.address.create({ data: { user_id: client.id, contact_name: 'QA', contact_phone: '600000009', street_line_1: 'C/ Ganancias 9', postcode: '28016', city: 'Madrid', province: 'Madrid' }, select: { id: true } });
    const rider = await prisma.rider.create({ data: { name: `QA Rider Ganancias ${stamp}`, phone: `69${stamp}0`, vehicle_type: 'moto' }, select: { id: true } });
    riderId = rider.id;

    const order = async (variant: string, qty: number) => {
      const r = await call('/api/sales/orders', { method: 'POST', token: rep.token, body: { user_id: client.id, address_id: addr.id, delivery_fee: 3, items: [{ variant_id: vid(variant), quantity: qty }] } });
      const o = r.body.data?.order as { id: string; subtotal: string; order_number: string } | undefined;
      if (o) orderIds.push(o.id);
      return o!;
    };
    const adminView = async (id: string) => (await call(`/api/admin/orders/${id}`, { token: ops })).body.data?.rep_earning;
    const repView = async (id: string) => (await call(`/api/sales/orders/${id}`, { token: rep.token })).body.data;
    const repEarnings = async (token = rep.token) => (await call('/api/sales/earnings', { token })).body.data;
    const adminEarnings = async () => (await call(`/api/admin/sales-reps/${rep.id}/earnings`, { token: ops })).body.data;
    const entries = (kind: string, orderId?: string) => prisma.salesRepLedgerEntry.count({ where: { sales_rep_id: rep.id, kind: kind as never, ...(orderId ? { order_id: orderId } : {}) } });
    /** The routes record an ended order after answering: wait for it. */
    const waitFor = async (pred: () => Promise<boolean>) => { for (let i = 0; i < 40; i++) { if (await pred()) return true; await sleep(150); } return false; };

    // ─── 1. Expected: placed, not delivered ─────────────────
    const o1 = await order('A', 3);
    check('a rep builds an order: 3 × 10 = 30', Number(o1?.subtotal) === 30, o1?.subtotal);
    let rv = await repView(o1.id);
    check('the rep\'s order shows its earning: expected, 30 − 12 = 18 net, no % yet → 0,00',
      rv?.earning?.status === 'expected' && rv.earning.sales === '30.00' && rv.earning.net_profit === '18.00' && rv.earning.percentage === null && rv.earning.earning === '0.00', rv?.earning);
    check('...and never a buying price — not on the earning, not on the lines', !leaksBuying(rv), rv && JSON.stringify(rv).match(/unit_cost|buying|cost_price/)?.[0]);
    const pct = await call(`/api/admin/sales-reps/${rep.id}`, { method: 'PUT', token: sa, body: { commission_pct: 10 } });
    rv = await repView(o1.id);
    check('their usual % set to 10: the order follows it — 1,80', pct.status === 200 && rv?.earning?.percentage === '10.00' && rv.earning.earning === '1.80', rv?.earning);

    let av = await adminView(o1.id);
    check('the admin\'s order carries it with the buying total: 30 − 12 = 18 → 1,80, the rep\'s %',
      av?.status === 'expected' && av.sales === '30.00' && av.buying === '12.00' && av.net_profit === '18.00' && av.earning === '1.80' && av.pct_source === 'rep' && av.rep?.user_id === rep.id,
      av);
    check('...and it cannot be approved before delivery', av?.can_approve === false && av.approve_blocker === 'not_delivered');
    const early = await call(`/api/admin/orders/${o1.id}/rep-earning/approve`, { method: 'POST', token: sa });
    check('approving early is refused', early.status === 422, early.status);

    // ─── 2. Expenses and the order's own % ──────────────────
    const byOps = await call(`/api/admin/orders/${o1.id}/rep-earning`, { method: 'PUT', token: ops, body: { commission_pct: null, expenses: [] } });
    const byRep = await call(`/api/admin/orders/${o1.id}/rep-earning`, { method: 'PUT', token: rep.token, body: { commission_pct: null, expenses: [] } });
    check('an ops admin cannot set them, nor can a rep', byOps.status === 403 && (byRep.status === 401 || byRep.status === 403), [byOps.status, byRep.status]);
    const bad1 = await call(`/api/admin/orders/${o1.id}/rep-earning`, { method: 'PUT', token: sa, body: { commission_pct: 150, expenses: [] } });
    const bad2 = await call(`/api/admin/orders/${o1.id}/rep-earning`, { method: 'PUT', token: sa, body: { commission_pct: null, expenses: [{ label: 'X', amount: -1 }] } });
    check('a % over 100 or a negative expense is refused', bad1.status === 422 && bad2.status === 422, [bad1.status, bad2.status]);
    const ex = await call(`/api/admin/orders/${o1.id}/rep-earning`, { method: 'PUT', token: sa, body: { commission_pct: null, expenses: [{ label: 'Reparto', amount: 5 }, { label: 'Gasolina', amount: 3 }] } });
    check('expenses of 5 + 3: 30 − 12 − 8 = 10 → 1,00', ex.status === 200 && ex.body.data?.expenses_total === '8.00' && ex.body.data?.net_profit === '10.00' && ex.body.data?.earning === '1.00', ex.body.data ?? ex.body);
    rv = await repView(o1.id);
    check('the rep sees the expenses itemised and the new figures', rv?.earning?.expenses?.map((e: { label: string }) => e.label).join() === 'Reparto,Gasolina' && rv.earning.earning === '1.00');

    // ─── 3. Delivered: waiting for approval ─────────────────
    await prisma.order.update({ where: { id: o1.id }, data: { status: 'on_the_way', rider_id: rider.id } });
    const before = Date.now();
    const mark = await call(`/api/admin/orders/${o1.id}/status`, { method: 'PUT', token: sa, body: { status: 'delivered' } });
    const row = await prisma.order.findUnique({ where: { id: o1.id }, select: { delivered_at: true } });
    check('staff mark it delivered, and when is recorded', mark.status === 200 && !!row?.delivered_at && row.delivered_at.getTime() >= before - 2000);
    av = await adminView(o1.id);
    check('...now it waits for approval, and can be approved', av?.status === 'awaiting_approval' && av.can_approve === true, av && [av.status, av.can_approve]);
    let re = await repEarnings();
    check('the rep: 1,00 waiting for approval, nothing owed yet',
      re?.totals?.awaiting_approval === '1.00' && re.totals.awaiting_count === 1 && re.totals.owed === '0.00' && re.pending?.[0]?.id === o1.id && re.pending[0].status === 'awaiting_approval', re?.totals);

    // ─── 4. Approved: owed ───────────────────────────────────
    const byOpsApprove = await call(`/api/admin/orders/${o1.id}/rep-earning/approve`, { method: 'POST', token: ops });
    check('an ops admin cannot approve', byOpsApprove.status === 403);
    const ok = await call(`/api/admin/orders/${o1.id}/rep-earning/approve`, { method: 'POST', token: sa });
    check('a super admin approves it: 1,00', ok.status === 200 && ok.body.data?.status === 'approved' && ok.body.data?.approved?.earning === '1.00', ok.body.data ?? ok.body);
    re = await repEarnings();
    check('this month: the approved order\'s 8,00 expenses and 10,00 net profit', re?.month?.expenses === '8.00' && re.month.net_profit === '10.00' && re.month.orders === 1, re?.month);
    check('...the rep is owed 1,00, earned 1,00, nothing waiting', re?.totals?.owed === '1.00' && re.totals.earned === '1.00' && re.totals.awaiting_count === 0 && re.history?.[0]?.kind === 'order_earning' && re.history[0].balance === '1.00', re?.totals);
    rv = await repView(o1.id);
    check('...and their order says approved, with the breakdown as approved',
      rv?.earning?.status === 'approved' && rv.earning.earning === '1.00' && rv.earning.net_profit === '10.00' && rv.earning.percentage === '10.00' && !!rv.earning.approved_at && rv.earning.expenses.length === 2, rv?.earning);
    check('two profits: 18,00 before expenses, 10,00 after', rv?.earning?.gross_profit === '18.00' && rv.earning.net_profit === '10.00', rv?.earning && [rv.earning.gross_profit, rv.earning.net_profit]);

    // A line of the history, opened: the order's breakdown.
    const earnedLine = re?.history?.find((h: { kind: string }) => h.kind === 'order_earning');
    const repOpen = await call(`/api/sales/earnings/entries/${earnedLine?.id}`, { token: rep.token });
    const be = repOpen.body.data?.order?.earning;
    check('the rep opens the history line: the order, both profits, the expenses, the %, the earning',
      repOpen.status === 200 && repOpen.body.data?.order?.order_number === o1.order_number && be?.gross_profit === '18.00' && be?.net_profit === '10.00'
        && be?.expenses?.length === 2 && be?.percentage === '10.00' && be?.earning === '1.00' && repOpen.body.data?.entry?.amount === '1.00', repOpen.body.data);
    check('...and no buying price in it', !leaksBuying(repOpen.body));
    const adminOpen = await call(`/api/admin/sales-reps/${rep.id}/earnings/entries/${earnedLine?.id}`, { token: ops });
    check('the admin opens the same line: with the buying total (12,00)', adminOpen.status === 200 && adminOpen.body.data?.order?.earning?.buying === '12.00' && adminOpen.body.data?.order?.earning?.gross_profit === '18.00', adminOpen.body.data?.order?.earning);
    check('another rep cannot open it', (await call(`/api/sales/earnings/entries/${earnedLine?.id}`, { token: other.token })).status === 404);

    const again = await call(`/api/admin/orders/${o1.id}/rep-earning/approve`, { method: 'POST', token: sa });
    check('approving again with nothing changed writes nothing', again.status === 422 || (again.status === 200 && (await entries('order_earning', o1.id)) === 1 && (await entries('order_adjustment', o1.id)) === 0), again.status);
    const frozen = await prisma.salesRepOrderEarning.findUnique({ where: { order_id: o1.id }, select: { commission_pct: true } });
    check('approval fixes the % on the order', frozen?.commission_pct?.toFixed(2) === '10.00');

    // ─── 5. Changes after approval ──────────────────────────
    await call(`/api/admin/sales-reps/${rep.id}`, { method: 'PUT', token: sa, body: { commission_pct: 20 } });
    av = await adminView(o1.id);
    check('the rep\'s usual % moving to 20 leaves the approved order at 10', av?.percentage === '10.00' && av.earning === '1.00' && av.changed_since_approval === false, av && [av.percentage, av.earning, av.changed_since_approval]);
    const line = await prisma.orderItem.findFirst({ where: { order_id: o1.id }, select: { id: true } });
    await call(`/api/admin/orders/${o1.id}/item-costs`, { method: 'PUT', token: sa, body: { items: [{ order_item_id: line!.id, unit_cost: 3 }] } });
    av = await adminView(o1.id);
    check('a buying price corrected to 3: now 30 − 9 − 8 = 13 → 1,30, flagged as changed', av?.earning === '1.30' && av.changed_since_approval === true && av.can_approve === true && av.approved?.earning === '1.00', av && [av.earning, av.changed_since_approval]);
    rv = await repView(o1.id);
    check('...the rep still sees what was approved, 1,00', rv?.earning?.earning === '1.00' && rv.earning.status === 'approved');
    const ae = await adminEarnings();
    check('...and the rep\'s profile lists it to review', (ae?.changed ?? []).some((o: { id: string }) => o.id === o1.id), ae?.changed);
    await call(`/api/admin/orders/${o1.id}/rep-earning/approve`, { method: 'POST', token: sa });
    re = await repEarnings();
    check('approved again: the difference, +0,30, is written — owed 1,30',
      re?.totals?.owed === '1.30' && re.history?.[0]?.kind === 'order_adjustment' && re.history[0].amount === '0.30' && (await entries('order_earning', o1.id)) === 1, re?.history?.[0]);

    // ─── 6. A loss ───────────────────────────────────────────
    const o2 = await order('B', 1);
    await prisma.order.update({ where: { id: o2.id }, data: { status: 'delivered', delivered_at: new Date() } });
    const lossApprove = await call(`/api/admin/orders/${o2.id}/rep-earning/approve`, { method: 'POST', token: sa });
    check('an order at a loss (20 − 25) is approved at 0,00 and the balance does not move',
      lossApprove.status === 200 && lossApprove.body.data?.approved?.earning === '0.00' && lossApprove.body.data?.net_profit === '-5.00' && (await repEarnings())?.totals?.owed === '1.30', lossApprove.body.data);

    // ─── 7. Paying, voiding, adjusting ──────────────────────
    const P = (p = '') => `/api/admin/sales-reps/${rep.id}/earnings${p}`;
    check('an ops admin cannot record a payment', (await call(P('/payouts'), { method: 'POST', token: ops, body: { amount: 1 } })).status === 403);
    check('a payment of 0 is refused', (await call(P('/payouts'), { method: 'POST', token: sa, body: { amount: 0 } })).status === 422);
    const pay = await call(P('/payouts'), { method: 'POST', token: sa, body: { amount: 1, paid_on: '2026-10-27', note: 'Transferencia' } });
    re = await repEarnings();
    check('a payment of 1,00 on 27 Oct: owed 0,30, paid 1,00',
      pay.status === 201 && re?.totals?.owed === '0.30' && re.totals.paid === '1.00' && re.history?.[0]?.kind === 'payout' && re.history[0].occurred_on === '2026-10-27' && re.history[0].note === 'Transferencia', re?.totals);
    const voided = await call(P(`/payouts/${pay.body.data?.id}/void`), { method: 'POST', token: sa, body: { reason: 'Importe equivocado' } });
    re = await repEarnings();
    check('voided: owed 1,30 again, paid 0,00, the payment marked voided',
      voided.status === 200 && re?.totals?.owed === '1.30' && re.totals.paid === '0.00' && re.history?.find((h: { id: string }) => h.id === pay.body.data?.id)?.voided === true, re?.totals);
    check('...and it cannot be voided twice', (await call(P(`/payouts/${pay.body.data?.id}/void`), { method: 'POST', token: sa, body: {} })).status === 409);
    const notPayout = await prisma.salesRepLedgerEntry.findFirst({ where: { sales_rep_id: rep.id, kind: 'order_earning' }, select: { id: true } });
    check('...only a payment can be voided', (await call(P(`/payouts/${notPayout!.id}/void`), { method: 'POST', token: sa, body: {} })).status === 422);
    check('an adjustment of 0, or one without a note, is refused',
      (await call(P('/adjustments'), { method: 'POST', token: sa, body: { amount: 0, note: 'x' } })).status === 422
      && (await call(P('/adjustments'), { method: 'POST', token: sa, body: { amount: 2 } })).status === 422);
    await call(P('/adjustments'), { method: 'POST', token: sa, body: { amount: 2, note: 'Bonus de octubre' } });
    await call(P('/adjustments'), { method: 'POST', token: sa, body: { amount: -0.5, note: 'Muestra perdida' } });
    re = await repEarnings();
    const balances = (re?.history ?? []) as { amount: string; balance: string }[];
    const runningOk = balances.every((h, i) => i === balances.length - 1 || D(balances[i + 1].balance).plus(h.amount).equals(h.balance));
    check('a bonus of 2 and a deduction of 0,50: owed 2,80, and every line of the history adds up',
      re?.totals?.owed === '2.80' && re.totals.earned === '2.80' && balances[0]?.balance === '2.80' && runningOk, re?.totals);

    // ─── 8. Cancelled and deleted ───────────────────────────
    const o3 = await order('A', 1);
    const repCancel = await call(`/api/sales/orders/${o3.id}/cancel`, { method: 'PUT', token: rep.token, body: { reason: 'El cliente cambia de idea' } });
    const recorded3 = await waitFor(async () => (await entries('order_not_earned', o3.id)) === 1);
    const ne = await prisma.salesRepLedgerEntry.findFirst({ where: { order_id: o3.id, kind: 'order_not_earned' }, select: { amount: true, reference_amount: true } });
    // A at 10, now costing 3 (the line price set the product's), at their 20%: 10 − 3 = 7 → 1,40.
    check('the rep cancels an order: recorded as not earned, with the 1,40 it was expected to earn, 0 to the balance',
      repCancel.status === 200 && recorded3 && ne?.amount.isZero() === true && ne?.reference_amount?.toFixed(2) === '1.40', { status: repCancel.status, ne });
    rv = await repView(o3.id);
    check('...and their order says not earned', rv?.earning?.status === 'not_earned');
    const o4 = await order('A', 1);
    await call(`/api/admin/orders/${o4.id}/status`, { method: 'PUT', token: sa, body: { status: 'cancelled', reason: 'Sin stock' } });
    check('staff cancelling one records it too', await waitFor(async () => (await entries('order_not_earned', o4.id)) === 1));
    check('a cancelled order\'s figures can no longer be set', (await call(`/api/admin/orders/${o4.id}/rep-earning`, { method: 'PUT', token: sa, body: { commission_pct: 5, expenses: [] } })).status === 422);

    const del = await call(`/api/admin/orders/${o1.id}/delete`, { method: 'POST', token: sa, body: { reason: 'Prueba' } });
    const reversed = await waitFor(async () => (await entries('order_reversal', o1.id)) === 1);
    re = await repEarnings();
    check('an approved order deleted: its 1,30 is taken back — owed 1,50',
      del.status === 200 && reversed && re?.totals?.owed === '1.50' && re.history?.some((h: { kind: string; amount: string }) => h.kind === 'order_reversal' && h.amount === '-1.30'), re?.totals);
    av = await adminView(o1.id);
    check('...the admin sees it reversed, and it cannot be approved again',
      av?.status === 'reversed' && !!av.reversed_at && (await call(`/api/admin/orders/${o1.id}/rep-earning/approve`, { method: 'POST', token: sa })).status === 422, av && [av.status, av.reversed_at]);
    check('...the history keeps its number but no way into a deleted order', re?.history?.find((h: { kind: string }) => h.kind === 'order_reversal')?.order?.id === null);
    await call(`/api/admin/orders/${o3.id}/delete`, { method: 'POST', token: sa, body: {} });
    await sleep(600);
    check('deleting an order already recorded as cancelled writes nothing more', (await entries('order_not_earned', o3.id)) === 1 && (await entries('order_reversal', o3.id)) === 0);

    // A path that forgot to record it — the earnings read catches it.
    const o5 = await order('A', 1);
    await prisma.order.update({ where: { id: o5.id }, data: { status: 'cancelled' } });
    await repEarnings();
    check('an order cancelled without going through a route is recorded the next time earnings are read', (await entries('order_not_earned', o5.id)) === 1);
    const o6 = await order('A', 1);
    await prisma.order.update({ where: { id: o6.id }, data: { status: 'draft' } });
    await call(`/api/admin/orders/${o6.id}/delete`, { method: 'POST', token: sa, body: {} });
    await sleep(600);
    await repEarnings();
    check('a draft thrown away was never a sale: nothing recorded', (await prisma.salesRepLedgerEntry.count({ where: { order_id: o6.id } })) === 0);

    // ─── 9. Only theirs, never a buying price ───────────────
    const theirs = await repEarnings(other.token);
    check('another rep sees none of it', theirs?.totals?.owed === '0.00' && theirs.history?.length === 0 && theirs.pending?.length === 0, theirs?.totals);
    check('...and cannot open this rep\'s order', (await call(`/api/sales/orders/${o2.id}`, { token: other.token })).status === 404);
    check('the rep\'s earnings carry no buying price anywhere', !leaksBuying(await repEarnings()));
    check('a rep cannot reach the admin\'s earnings', [401, 403].includes((await call(P(), { token: rep.token })).status));

    // ─── 10. The profile's "view all": the order list for one rep ─
    const mine = await prisma.order.count({ where: { created_by_sales_rep_id: rep.id, deleted_at: null } });
    const grouped = await call(`/api/admin/orders?grouped=true&salesRepId=${rep.id}&limit=100`, { token: ops });
    const flat = await call(`/api/admin/orders?salesRepId=${rep.id}&limit=100`, { token: ops });
    check('the order list filtered to one rep has all of theirs — grouped and flat', grouped.status === 200 && grouped.body.data?.total === mine && flat.body.data?.total === mine, { want: mine, grouped: grouped.body.data?.total, flat: flat.body.data?.total });

    // ─── 11. The rep's bell ─────────────────────────────────
    type Note = { id: string; type: string; deeplink: string | null; body_es: string };
    let inbox: Note[] = [];
    for (let i = 0; i < 30 && inbox.length < 10; i++) {
      inbox = (await call('/api/sales/notifications?limit=50', { token: rep.token })).body.data?.items ?? [];
      if (inbox.length < 10) await sleep(200);
    }
    const tally = inbox.reduce<Record<string, number>>((m, n) => ({ ...m, [n.type]: (m[n.type] ?? 0) + 1 }), {});
    check('the rep is told: delivered, approved ×3 (o1, its update, the loss), paid, adjusted ×3 (void, bonus, deduction), cancelled by staff, reversed — not their own cancel',
      tally.rep_order_delivered === 1 && tally.rep_earning_approved === 3 && tally.rep_payout_recorded === 1 && tally.rep_earning_adjusted === 3
        && tally.rep_order_cancelled === 1 && tally.rep_earning_reversed === 1 && inbox.length === 10, tally);
    const approvedNote = inbox.find((n) => n.type === 'rep_earning_approved' && /1,00/.test(n.body_es));
    check('...an approval points at its order', approvedNote?.deeplink === `/sales/orders/${o1.id}`, approvedNote);
    check('...a payment points at their earnings', inbox.find((n) => n.type === 'rep_payout_recorded')?.deeplink === '/sales/earnings');
    const otherInbox = await call('/api/sales/notifications', { token: other.token });
    check('another rep\'s bell is empty', otherInbox.body.data?.total === 0);

    // ─── 12. A profit set by hand ───────────────────────────
    // (2026-10-28) The admin types in the gross profit (the expenses still
    // come off) or the net profit (nothing comes off); which, how much, who
    // and when are recorded against the order. After the bell's count above.
    // Size A has bought at 3 since section 5 corrected it: 30 of products, 9 of buying.
    const o7 = await order('A', 3);
    const put7 = (body: unknown, token = sa) => call(`/api/admin/orders/${o7.id}/rep-earning`, { method: 'PUT', token, body });
    const fees = [{ label: 'Reparto', amount: 2 }];
    const setRow = () => prisma.salesRepOrderEarning.findUnique({
      where: { order_id: o7.id }, select: { profit_basis: true, profit_override: true, profit_set_by_admin_id: true, profit_set_at: true },
    });
    let p = await put7({ commission_pct: 10, expenses: fees, profit: { basis: 'gross', amount: 25 } });
    check('the gross profit set by hand at 25: the 2 of expenses still come off — net 23, earns 2,30',
      p.status === 200 && p.body.data?.gross_profit === '25.00' && p.body.data?.net_profit === '23.00' && p.body.data?.earning === '2.30'
        && p.body.data?.profit_basis === 'gross' && p.body.data?.buying === '9.00', p.body.data ?? p.body);
    const set1 = await setRow();
    check('...recorded against the order: which, how much, by whom, when',
      set1?.profit_basis === 'gross' && set1.profit_override?.toFixed(2) === '25.00' && set1.profit_set_by_admin_id === admin.id
        && !!set1.profit_set_at && p.body.data?.profit_set?.amount === '25.00' && typeof p.body.data?.profit_set?.by === 'string',
      { set1, view: p.body.data?.profit_set });
    rv = await repView(o7.id);
    check('the rep sees the profit as set by hand — never who set it, never a buying price',
      rv?.earning?.profit_basis === 'gross' && rv.earning.gross_profit === '25.00' && rv.earning.net_profit === '23.00' && rv.earning.earning === '2.30'
        && !leaksBuying(rv) && !JSON.stringify(rv).includes('profit_set'), rv?.earning);
    await sleep(20);
    await put7({ commission_pct: 10, expenses: fees, profit: { basis: 'gross', amount: 25 } });
    check('saving it unchanged keeps when it was set', (await setRow())?.profit_set_at?.getTime() === set1?.profit_set_at?.getTime());
    await put7({ commission_pct: 10, expenses: fees });
    av = await adminView(o7.id);
    check('a save without the profit — an older screen — leaves it as set', av?.profit_basis === 'gross' && av.net_profit === '23.00', av && [av.profit_basis, av.net_profit]);

    p = await put7({ commission_pct: 10, expenses: fees, profit: { basis: 'net', amount: 15 } });
    check('the net profit set by hand at 15: nothing comes off — earns 1,50',
      p.body.data?.net_profit === '15.00' && p.body.data?.earning === '1.50' && p.body.data?.profit_basis === 'net' && p.body.data?.expenses_total === '2.00',
      p.body.data && [p.body.data.net_profit, p.body.data.earning, p.body.data.profit_basis]);
    const [byOps7, badBasis] = await Promise.all([
      put7({ commission_pct: 10, expenses: fees, profit: { basis: 'net', amount: 99 } }, ops),
      put7({ commission_pct: 10, expenses: fees, profit: { basis: 'total', amount: 5 } }),
    ]);
    check('an ops admin cannot set it, and only "gross" or "net" is taken', byOps7.status === 403 && badBasis.status === 422, [byOps7.status, badBasis.status]);

    await prisma.order.update({ where: { id: o7.id }, data: { status: 'delivered', delivered_at: new Date() } });
    const ap7 = await call(`/api/admin/orders/${o7.id}/rep-earning/approve`, { method: 'POST', token: sa });
    check('approved at the net set by hand: 1,50 — and the approval keeps which profit it was',
      ap7.status === 200 && ap7.body.data?.approved?.earning === '1.50' && ap7.body.data?.approved?.profit_basis === 'net' && ap7.body.data?.approved?.net_profit === '15.00',
      ap7.body.data?.approved ?? ap7.body);
    p = await put7({ commission_pct: 10, expenses: fees, profit: { basis: 'net', amount: 20 } });
    rv = await repView(o7.id);
    check('changed after approval: flagged, 2,00 now — the rep still sees the 1,50 approved',
      p.body.data?.changed_since_approval === true && p.body.data?.earning === '2.00' && rv?.earning?.earning === '1.50' && rv.earning.profit_basis === 'net',
      [p.body.data?.changed_since_approval, p.body.data?.earning, rv?.earning?.earning]);
    await call(`/api/admin/orders/${o7.id}/rep-earning/approve`, { method: 'POST', token: sa });
    const adj7 = await prisma.salesRepLedgerEntry.findFirst({ where: { order_id: o7.id, kind: 'order_adjustment' }, select: { amount: true } });
    check('approved again: the difference, +0,50, is written', adj7?.amount.toFixed(2) === '0.50', adj7?.amount);
    p = await put7({ commission_pct: 10, expenses: fees, profit: null });
    check('cleared: worked out again — 30 − 9 − 2 = 19 → 1,90, flagged as changed, nothing recorded as set',
      p.body.data?.profit_basis === null && p.body.data?.net_profit === '19.00' && p.body.data?.earning === '1.90'
        && p.body.data?.profit_set === null && p.body.data?.changed_since_approval === true && (await setRow())?.profit_set_by_admin_id === null,
      p.body.data && [p.body.data.profit_basis, p.body.data.net_profit, p.body.data.earning]);
  } finally {
    if (orderIds.length) {
      await prisma.orderEditLog.deleteMany({ where: { order_id: { in: orderIds } } });
      await prisma.orderItem.deleteMany({ where: { order_id: { in: orderIds } } });
      await prisma.orderIdempotency.deleteMany({ where: { order_id: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    await prisma.notification.deleteMany({ where: { user_id: { in: userIds } } }).catch(() => {});
    if (riderId) await prisma.rider.delete({ where: { id: riderId } }).catch(() => {});
    if (productId) {
      await prisma.cartItem.deleteMany({ where: { variant: { product_id: productId } } }).catch(() => {});
      await prisma.productVariant.deleteMany({ where: { product_id: productId } });
      await prisma.product.delete({ where: { id: productId } });
    }
    if (userIds.length) {
      await prisma.address.deleteMany({ where: { user_id: { in: userIds } } });
      // Takes their ledger and earnings rows with it.
      await prisma.salesRep.deleteMany({ where: { user_id: { in: userIds } } });
      await prisma.user.updateMany({ where: { id: { in: userIds } }, data: { created_by_sales_rep_id: null } });
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
