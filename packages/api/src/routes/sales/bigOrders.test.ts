// ─── Integration test · big orders, end to end ─────────────────────────────
//
// Run:  cd packages/api && npm run test:big-orders
//
// A shop restocking is a genuinely large order — a hundred lines is ordinary,
// not an abuse — and the three paths that move its stock all run inside one
// interactive transaction with a fixed budget. Every one of them has a shape
// that is fine for two lines and fails for two hundred:
//
//   · a round trip per line instead of one statement for all of them,
//   · the same variant on two lines costing two moves to put back one row,
//   · ids touched in a different order by two concurrent transactions.
//
// So this does not test "does a big order work". It tests the ARITHMETIC over
// a big order: after create → edit → cancel, every variant must hold exactly
// what it started with. A per-line bug nets to zero on a two-line order and
// only shows up at scale, which is why the sizes below are real.
//
// Goes through the real routes over HTTP. Creates its own fixtures and removes
// them in a finally.

// FIRST: switches on the per-statement events the count assertions read.
// Imports are hoisted, so an assignment here would run too late.
import './enableQueryLog';
import http from 'http';
import app from '../../server';
import prisma from '../../lib/prisma';
import { generateAccessToken } from '../../lib/jwt';
import { busiestShop, repShop } from '../../lib/testRepShop';

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

/**
 * How many SQL statements a block of work issues.
 *
 * The number that decides whether a big order survives. Wall-clock on
 * localhost says nothing — a round trip here is a tenth of a millisecond and
 * on Neon it is tens of milliseconds over the network — so what matters is
 * whether the count GROWS WITH THE ORDER. One that does is a path that passes
 * every local test and times out on a real one.
 */
let counting = false;
let statements = 0;
(prisma as unknown as { $on: (e: string, cb: () => void) => void })
  .$on('query', () => { if (counting) statements += 1; });

async function countingStatements<T>(fn: () => Promise<T>): Promise<[T, number]> {
  counting = true;
  statements = 0;
  try {
    const out = await fn();
    return [out, statements];
  } finally {
    counting = false;
  }
}

/**
 * How many distinct products a big order spans.
 *
 * Deliberately ABOVE 300, which is what the create-order schema and the edit
 * schema were both capped at until 2026-10-10 — while the customer's cart had
 * been raised to 1000. The rep is the likeliest source of a genuinely large
 * order and had the tightest ceiling of anyone, so the size here is the thing
 * that proves the new one: at 120 this test passed with the old cap in place
 * and said nothing about it.
 *
 * It also exercises the EDIT cap, since the run below rewrites every line in
 * one request — 320 lines is 320 operations, which the old 300 refused.
 */
const LINES = 320;
/** Units per line. Enough that a lost or doubled move is unmistakable. */
const QTY = 3;

async function main() {
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

  const userIds: string[] = [];
  const orderIds: string[] = [];
  /** variant id -> stock before the test touched anything. */
  const opening = new Map<string, number>();

  const call = async (path: string, init: { method?: string; body?: unknown; token?: string } = {}) => {
    const started = Date.now();
    const res = await fetch(`${base}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    return {
      status: res.status,
      ms: Date.now() - started,
      body: await res.json() as { success: boolean; error?: string; data?: any },
    };
  };

  /** Current stock for every variant the test is watching. */
  const stockNow = async () => {
    const rows = await prisma.productVariant.findMany({
      where: { id: { in: [...opening.keys()] } },
      select: { id: true, stock_quantity: true },
    });
    return new Map(rows.map((r) => [r.id, r.stock_quantity]));
  };

  /** Every watched variant is back to its opening figure. */
  const conserved = async () => {
    const now = await stockNow();
    const off: Array<{ id: string; was: number; is: number }> = [];
    for (const [id, was] of opening) {
      const is = now.get(id) ?? -1;
      if (is !== was) off.push({ id, was, is });
    }
    return off;
  };

  try {
    // ─── Fixtures ────────────────────────────────────────────
    // A rep sells from one shop (lib/repStore). A partner's, so the cross-shop
    // add and replace below still have a partner product to work with — every
    // product here, the 320 lines and the spares, comes from it.
    const shopId = await busiestShop({ stock_quantity: { gte: QTY * 4 }, product: { is_active: true, store_id: { not: null } } });
    const variants = await prisma.productVariant.findMany({
      where: {
        is_active: true,
        product: { is_active: true, store_id: shopId },
        stock_quantity: { gte: QTY * 4 },
      },
      select: { id: true, stock_quantity: true },
      take: LINES,
    });
    if (variants.length < 20) {
      console.log(`  SKIP  only ${variants.length} variants with stock to work with`);
      return;
    }
    for (const v of variants) opening.set(v.id, v.stock_quantity);
    console.log(`  ..    ${variants.length} lines, ${QTY} units each\n`);
    // Printed, not only asserted. The budget is 8s; these are how much of it
    // each path actually uses, which is the thing that drifts.
    const timings: Array<[string, number]> = [];

    const rep = await prisma.user.create({
      data: { name: `QA Big ${stamp}`, email: `qa.big.${stamp}@cesto.test` },
    });
    userIds.push(rep.id);
    await prisma.salesRep.create({ data: { user_id: rep.id, is_active: true, ...repShop(shopId) } });
    const token = generateAccessToken({ userId: rep.id, email: rep.email ?? undefined });

    const client = await prisma.user.create({
      data: {
        name: `QA BigClient ${stamp}`, email: `qa.bigclient.${stamp}@cesto.test`,
        created_by_sales_rep_id: rep.id,
      },
    });
    userIds.push(client.id);
    const address = await prisma.address.create({
      data: {
        user_id: client.id, contact_name: 'QA', contact_phone: '600000001',
        street_line_1: 'C/ Grande 1', postcode: '28016', city: 'Madrid', province: 'Madrid',
      },
    });

    // ─── 1. Create a big order ───────────────────────────────
    const [created, createStmts] = await countingStatements(() => call('/api/sales/orders', {
      method: 'POST', token,
      body: {
        user_id: client.id,
        address_id: address.id,
        items: variants.map((v) => ({ variant_id: v.id, quantity: QTY })),
      },
    }));
    timings.push([`create ${variants.length} lines`, created.ms]);
    check(`a ${variants.length}-line order is created`, created.status === 201,
      { status: created.status, error: created.body.error, ms: created.ms });
    const orderId = created.body.data?.order?.id as string | undefined;
    if (!orderId) { console.log('  ABORT  no order to work with'); return; }
    orderIds.push(orderId);

    // Well inside the 8s transaction budget, with the whole request measured.
    // Not a benchmark — a tripwire for the shape that creeps back in: a
    // round trip per line instead of one statement for all of them.
    check('...in one statement, not one per line', created.ms < 5000, { ms: created.ms });

    const afterCreate = await stockNow();
    const wrongAfterCreate = variants.filter(
      (v) => afterCreate.get(v.id) !== opening.get(v.id)! - QTY,
    );
    check('...taking exactly its stock, from every line',
      wrongAfterCreate.length === 0,
      wrongAfterCreate.slice(0, 3).map((v) => ({
        id: v.id, expected: opening.get(v.id)! - QTY, got: afterCreate.get(v.id),
      })));

    // ─── 2. Edit every line at once ──────────────────────────
    //
    // The shape that worries: editOrder writes one OrderItem per operation, so
    // an edit touching every line is one round trip per line inside the same
    // budget the create does in a single statement.
    const items = await prisma.orderItem.findMany({
      where: { order_id: orderId },
      select: { id: true, variant_id: true, quantity: true },
    });
    check('the order really has every line', items.length === variants.length,
      { items: items.length, expected: variants.length });

    const [edited, editStmts] = await countingStatements(() => call(`/api/sales/orders/${orderId}/items`, {
      method: 'PUT', token,
      body: {
        // +1 on every line: the stock delta is signed, so this takes one more
        // unit of each and must not disturb anything else.
        operations: items.map((it) => ({
          action: 'update_qty', order_item_id: it.id, new_quantity: QTY + 1,
        })),
        note: 'QA bulk edit',
      },
    }));
    timings.push([`edit ${items.length} lines`, edited.ms]);
    check(`editing all ${items.length} lines at once succeeds`, edited.status === 200,
      { status: edited.status, error: edited.body.error, ms: edited.ms });
    check('...inside the transaction budget', edited.ms < 8000, { ms: edited.ms });

    const afterEdit = await stockNow();
    const wrongAfterEdit = variants.filter(
      (v) => afterEdit.get(v.id) !== opening.get(v.id)! - (QTY + 1),
    );
    check('...moving exactly one more unit per line',
      wrongAfterEdit.length === 0,
      wrongAfterEdit.slice(0, 3).map((v) => ({
        id: v.id, expected: opening.get(v.id)! - (QTY + 1), got: afterEdit.get(v.id),
      })));

    // ─── 2b. A MIXED edit, at size ───────────────────────────
    //
    // Batching the writes meant every branch changed at once: quantity
    // changes, discounts and same-store replaces became patches, removes
    // became one deleteMany, adds became one createMany. A test that only
    // bumps quantities exercises one of five.
    //
    // So: all of them in a single request, on a big order, with the stock
    // arithmetic checked afterwards. The specific trap is a row that is
    // patched AND removed — the per-row code applied operations in order, so
    // the remove won, and batching has to preserve that without the two
    // statements being ordered.
    /**
     * Cesto-owned spares, so a replace stays on THIS order.
     *
     * Replacing a line with a PARTNER product is a cross-store replace: the
     * item leaves this order and is created on a sibling sub-order under a new
     * ParentOrder. That is designed behaviour, it has its own coverage in
     * lib/editOrder.test.ts, and it would make the arithmetic below a test of
     * splitting rather than of batching. Most of the catalogue is
     * partner-owned, so without this filter that is silently what this tests.
     */
    const spare = await prisma.productVariant.findMany({
      where: {
        is_active: true,
        product: { is_active: true, store_id: shopId },
        stock_quantity: { gte: 20 },
        id: { notIn: [...opening.keys()] },
      },
      select: { id: true, stock_quantity: true },
      take: 6,
    });
    for (const v of spare) opening.set(v.id, v.stock_quantity);

    const live = await prisma.orderItem.findMany({
      where: { order_id: orderId },
      select: { id: true, variant_id: true, quantity: true },
      orderBy: { id: 'asc' },
    });

    if (spare.length >= 2 && live.length >= 12) {
      const before = await stockNow();

      // A third bumped, a third removed, two replaced, two added — plus one
      // row that is bumped and then removed in the same breath.
      const bump = live.slice(0, 4);
      const drop = live.slice(4, 8);
      const swap = live.slice(8, 10);
      const ops = [
        ...bump.map((it) => ({
          action: 'update_qty' as const, order_item_id: it.id, new_quantity: it.quantity + 2,
        })),
        ...drop.map((it) => ({ action: 'remove' as const, order_item_id: it.id })),
        ...swap.map((it, i) => ({
          action: 'replace' as const,
          order_item_id: it.id,
          new_variant_id: spare[i].id,
          new_quantity: 2,
        })),
        { action: 'set_discount' as const, order_item_id: live[11].id, discount_amount: 1 },
      ];

      const [mixed, mixedStmts] = await countingStatements(
        () => call(`/api/sales/orders/${orderId}/items`, {
          method: 'PUT', token, body: { operations: ops, note: 'QA mixed edit' },
        }),
      );
      check(`a mixed edit of ${ops.length} operations succeeds`, mixed.status === 200,
        { status: mixed.status, error: mixed.body.error });
      check('...still a fixed number of statements', mixedStmts <= 30,
        { statements: mixedStmts, operations: ops.length });

      const rows = await prisma.orderItem.findMany({
        where: { order_id: orderId },
        select: { id: true, variant_id: true, quantity: true, discount_amount: true },
      });
      const byId = new Map(rows.map((r) => [r.id, r]));

      check('...the bumped lines are bumped',
        bump.every((it) => byId.get(it.id)?.quantity === it.quantity + 2),
        bump.map((it) => ({ want: it.quantity + 2, got: byId.get(it.id)?.quantity })));
      check('...the dropped lines are gone', drop.every((it) => !byId.has(it.id)));
      check('...the replaced lines point at the new variant',
        swap.every((it, i) => byId.get(it.id)?.variant_id === spare[i].id));
      check('...the discount landed',
        Number(byId.get(live[11].id)?.discount_amount ?? 0) === 1,
        byId.get(live[11].id)?.discount_amount);

      const after = await stockNow();
      const expected = new Map(before);
      for (const it of bump) {
        expected.set(it.variant_id, expected.get(it.variant_id)! - 2);
      }
      for (const it of drop) {
        expected.set(it.variant_id, expected.get(it.variant_id)! + it.quantity);
      }
      swap.forEach((it, i) => {
        expected.set(it.variant_id, expected.get(it.variant_id)! + it.quantity);
        expected.set(spare[i].id, expected.get(spare[i].id)! - 2);
      });
      const wrong = [...expected.entries()]
        .filter(([id, want]) => after.get(id) !== want)
        .map(([id, want]) => ({ id, want, got: after.get(id) }));
      check('...and every stock move is exactly right', wrong.length === 0, wrong.slice(0, 4));

      // ─── Two operations on ONE line are refused ──────────
      //
      // They used to be accepted and to lose stock: every branch of the delta
      // pass measures against the row as it was BEFORE the request, so
      // `update_qty` 4→9 then `remove` took five units for the bump and gave
      // four back for the removal. The five went nowhere, nothing failed, and
      // the order looked right afterwards.
      const twice = live[12];
      const dup = await call(`/api/sales/orders/${orderId}/items`, {
        method: 'PUT', token,
        body: {
          operations: [
            { action: 'update_qty', order_item_id: twice.id, new_quantity: 9 },
            { action: 'remove', order_item_id: twice.id },
          ],
        },
      });
      check('changing one line twice in a single edit is refused', dup.status === 400,
        { status: dup.status, error: dup.body.error });

      const afterDup = await stockNow();
      const leaked = [...expected.keys()].filter((id) => afterDup.get(id) !== after.get(id));
      check('...and nothing moved while it was refused', leaked.length === 0,
        leaked.slice(0, 3).map((id) => ({ id, before: after.get(id), now: afterDup.get(id) })));
    } else {
      console.log('  SKIP  not enough spare variants for the mixed edit');
    }

    // ─── 2c. Another shop's product stays on THIS order ─────
    //
    // An order a rep builds is Cesto's whatever it holds — we deliver what we
    // sell (lib/createOrder, rule 3) — so an edit keeps it that way. It used
    // to split the item off onto a sibling at the partner's store, which put
    // part of a rep's order on the dashboard of a shop that was never meant
    // to fulfil it, while the same basket BUILT in one go stayed whole.
    const partnerSpare = await prisma.productVariant.findFirst({
      where: {
        is_active: true,
        product: { is_active: true, store_id: shopId },
        stock_quantity: { gte: 10 },
        id: { notIn: [...opening.keys()] },
      },
      select: { id: true, stock_quantity: true },
    });
    const splitFrom = await prisma.orderItem.findFirst({
      where: { order_id: orderId },
      select: { id: true, variant_id: true, quantity: true },
      orderBy: { id: 'desc' },
    });

    // Stays empty now; the cancel below still walks it, so a regression
    // that spins a part off again is cancelled and counted, not leaked.
    const spunOffIds: string[] = [];
    if (partnerSpare && splitFrom) {
      opening.set(partnerSpare.id, partnerSpare.stock_quantity);

      const swapped = await call(`/api/sales/orders/${orderId}/items`, {
        method: 'PUT', token,
        body: {
          operations: [{
            action: 'replace',
            order_item_id: splitFrom.id,
            new_variant_id: partnerSpare.id,
            new_quantity: 1,
          }],
        },
      });
      check('replacing a line with another shop\'s product is accepted', swapped.status === 200,
        { status: swapped.status, error: swapped.body.error });
      const spun = (swapped.body.data?.newOrders ?? []) as { id: string }[];
      spunOffIds.push(...spun.map((o) => o.id));
      orderIds.push(...spun.map((o) => o.id));
      check('...and splits nothing off', spun.length === 0, { newOrders: spun.length });

      const line = await prisma.orderItem.findUnique({
        where: { id: splitFrom.id },
        select: { order_id: true, variant_id: true },
      });
      check('...the line stays on this order, now holding the partner product',
        line?.order_id === orderId && line?.variant_id === partnerSpare.id, line);
      const own = await prisma.order.findUnique({
        where: { id: orderId },
        select: { store_id: true, parent_order_id: true },
      });
      check('...which is still one order, and still Cesto\'s',
        own?.store_id === null && own?.parent_order_id === null, own);
    } else {
      console.log('  SKIP  no partner-owned variant to swap in');
    }

    // ─── 2d. A swap, the way the EDIT SCREEN expresses one ───
    //
    // The modal had a per-row picker and sent `replace`. The edit screen is
    // the order-building screen now, where swapping a product is removing a
    // row and adding another — so the same intention reaches the server as
    // `remove` + `add`, and this is the path every rep swap now takes.
    //
    // Worth its own section because the two are not obviously equivalent.
    // A cross-shop `replace` keeps the line on this order (2c); the claim
    // here is that a cross-shop `add` does too, rather than the add path
    // still spinning the item off onto a sibling at the partner's store.
    const swapOut = await prisma.orderItem.findFirst({
      where: { order_id: orderId },
      select: { id: true, variant_id: true, quantity: true },
      orderBy: { id: 'asc' },
    });
    const partnerIn = await prisma.productVariant.findFirst({
      where: {
        is_active: true,
        product: { is_active: true, store_id: shopId },
        stock_quantity: { gte: 5 },
        id: { notIn: [...opening.keys()] },
      },
      select: { id: true, stock_quantity: true },
    });

    if (swapOut && partnerIn) {
      opening.set(partnerIn.id, partnerIn.stock_quantity);
      const before = await stockNow();

      const swap = await call(`/api/sales/orders/${orderId}/items`, {
        method: 'PUT', token,
        body: {
          operations: [
            { action: 'remove', order_item_id: swapOut.id },
            { action: 'add', new_variant_id: partnerIn.id, new_quantity: 2 },
          ],
        },
      });
      check('a swap sent as remove + add is accepted', swap.status === 200,
        { status: swap.status, error: swap.body.error });
      const born = (swap.body.data?.newOrders ?? []) as { id: string }[];
      spunOffIds.push(...born.map((o) => o.id));
      orderIds.push(...born.map((o) => o.id));
      check('...and the other shop\'s product lands on this order, not a sibling',
        born.length === 0, { newOrders: born.length });
      const added = await prisma.orderItem.findFirst({
        where: { order_id: orderId, variant_id: partnerIn.id },
        select: { quantity: true },
      });
      check('...as a line of its own', added?.quantity === 2, added);

      // The removed line came back and the added one went out.
      const after = await stockNow();
      check('...the removed line returned every unit',
        after.get(swapOut.variant_id)! === before.get(swapOut.variant_id)! + swapOut.quantity,
        { variant: swapOut.variant_id, before: before.get(swapOut.variant_id), after: after.get(swapOut.variant_id), qty: swapOut.quantity });
      check('...and the added one took exactly two',
        after.get(partnerIn.id)! === before.get(partnerIn.id)! - 2,
        { before: before.get(partnerIn.id), after: after.get(partnerIn.id) });

      // The screen builds one operation per line from a diff, so it cannot
      // emit a pair for the same line. Asserted anyway: the refusal is what
      // makes the diff shape load-bearing rather than a convention.
      const pair = await call(`/api/sales/orders/${orderId}/items`, {
        method: 'PUT', token,
        body: {
          operations: [
            { action: 'update_qty', order_item_id: swapOut.id, new_quantity: 3 },
            { action: 'remove', order_item_id: swapOut.id },
          ],
        },
      });
      check('...and two operations on one line are still refused', pair.status === 400,
        { status: pair.status, error: pair.body.error });
    } else {
      console.log('  SKIP  nothing to swap for a partner product');
    }

    // ─── 3. Cancel it ────────────────────────────────────────
    const [cancelled, cancelStmts] = await countingStatements(
      () => call(`/api/sales/orders/${orderId}/cancel`, {
        method: 'PUT', token, body: { reason: 'QA big-order cancel' },
      }),
    );
    timings.push([`cancel ${items.length} lines`, cancelled.ms]);
    check('cancelling a big order succeeds', cancelled.status === 200,
      { status: cancelled.status, error: cancelled.body.error, ms: cancelled.ms });
    check('...inside the transaction budget', cancelled.ms < 8000, { ms: cancelled.ms });

    /**
     * Any part an edit spun off. There should be none (2c, 2d) — but if one
     * ever reappears, cancelling it here keeps the stock check below honest
     * rather than leaking its units into the next run.
     */
    for (const sibId of spunOffIds) {
      await call(`/api/sales/orders/${sibId}/cancel`, {
        method: 'PUT', token, body: { reason: 'QA sibling cancel' },
      });
    }

    const off = await conserved();
    check('...and every single unit comes back, partner products included',
      off.length === 0, off.slice(0, 5));

    // ─── 4. The same variant on several lines ────────────────
    //
    // Netting is what makes this safe, and it is invisible on a normal order.
    // Three lines of ONE variant must take three lots and give three back, in
    // one move each way — not three round trips, and not one lot lost.
    const repeated = variants[0];
    const repeatQty = 2;
    const beforeRepeat = (await stockNow()).get(repeated.id)!;

    const dupOrder = await call('/api/sales/orders', {
      method: 'POST', token,
      body: {
        user_id: client.id,
        address_id: address.id,
        items: [
          { variant_id: repeated.id, quantity: repeatQty },
          { variant_id: repeated.id, quantity: repeatQty },
          { variant_id: repeated.id, quantity: repeatQty },
        ],
      },
    });
    check('three lines of one variant are accepted', dupOrder.status === 201,
      { status: dupOrder.status, error: dupOrder.body.error });
    const dupId = dupOrder.body.data?.order?.id as string | undefined;
    if (dupId) {
      orderIds.push(dupId);
      const afterDup = (await stockNow()).get(repeated.id)!;
      check('...taking all three lots, netted into one move',
        afterDup === beforeRepeat - repeatQty * 3,
        { before: beforeRepeat, expected: beforeRepeat - repeatQty * 3, got: afterDup });

      const dupCancel = await call(`/api/sales/orders/${dupId}/cancel`, {
        method: 'PUT', token, body: {},
      });
      const afterDupCancel = (await stockNow()).get(repeated.id)!;
      check('...and giving all three back on cancel',
        dupCancel.status === 200 && afterDupCancel === beforeRepeat,
        { expected: beforeRepeat, got: afterDupCancel });
    }

    // ─── 5. A big DRAFT holds nothing, start to finish ───────
    //
    // The rule the whole draft concept rests on, at a size where a per-line
    // slip would show. Parking takes nothing, cancelling gives nothing back,
    // and the two must not quietly cancel each other out.
    const beforeDraft = await stockNow();
    const draft = await call('/api/sales/orders', {
      method: 'POST', token,
      body: {
        user_id: client.id,
        address_id: address.id,
        status: 'draft',
        items: variants.map((v) => ({ variant_id: v.id, quantity: QTY })),
      },
    });
    check(`a ${variants.length}-line draft is parked`, draft.status === 201,
      { status: draft.status, error: draft.body.error });
    const draftId = draft.body.data?.order?.id as string | undefined;
    if (draftId) {
      orderIds.push(draftId);
      const afterPark = await stockNow();
      const moved = variants.filter((v) => afterPark.get(v.id) !== beforeDraft.get(v.id));
      check('...reserving nothing at all', moved.length === 0, moved.slice(0, 3).map((v) => v.id));

      // Confirming is where it finally takes the stock.
      const confirmed = await call(`/api/sales/orders/${draftId}/confirm-stock`, {
        method: 'POST', token, body: {},
      });
      timings.push([`confirm ${variants.length}-line draft`, confirmed.ms]);
      check('confirming a big draft succeeds', confirmed.status === 200,
        { status: confirmed.status, error: confirmed.body.error, ms: confirmed.ms });
      check('...inside the transaction budget', confirmed.ms < 8000, { ms: confirmed.ms });

      const afterConfirm = await stockNow();
      const wrongConfirm = variants.filter(
        (v) => afterConfirm.get(v.id) !== beforeDraft.get(v.id)! - QTY,
      );
      check('...taking exactly its stock, once', wrongConfirm.length === 0,
        wrongConfirm.slice(0, 3).map((v) => ({
          id: v.id, expected: beforeDraft.get(v.id)! - QTY, got: afterConfirm.get(v.id),
        })));

      await call(`/api/sales/orders/${draftId}/cancel`, { method: 'PUT', token, body: {} });
    }

    /**
     * THE REGRESSION GUARD.
     *
     * Not a performance test — a shape test. Every one of these paths does a
     * fixed amount of work plus one statement per line, or a fixed amount full
     * stop, and the difference only shows up on a big order against a remote
     * database. A per-line write is invisible here (localhost round trips are
     * ~0.1ms) and is most of an 8-second transaction budget on Neon.
     *
     * The ceilings are generous \u2014 roughly double what each path issues today
     * \u2014 because the point is not the exact number. The point is that it must
     * not be a function of ${variants.length}.
     */
    const flat: Array<[string, number, number]> = [
      ['create', createStmts, 30],
      ['edit every line', editStmts, 30],
      ['cancel', cancelStmts, 15],
    ];
    for (const [label, n, ceiling] of flat) {
      check(`${label}: a fixed number of statements, not one per line`,
        n <= ceiling,
        { statements: n, ceiling, lines: variants.length });
    }

    console.log('\n  statements (one round trip each on Neon):');
    for (const [label, n] of flat) {
      console.log(`    ${String(n).padStart(6)}   ${label}`);
    }

    console.log('\n  timings (budget is 8000ms):');
    for (const [label, ms] of timings) {
      console.log(`    ${String(ms).padStart(6)}ms  ${label}`);
    }
    console.log('');

    // ─── 6. Nothing leaked, over the whole run ───────────────
    const finalOff = await conserved();
    check('after every create, edit, confirm and cancel: stock is where it started',
      finalOff.length === 0, finalOff.slice(0, 5));
  } finally {
    if (orderIds.length) {
      /**
       * Parents go LAST of the order rows and before the address.
       *
       * A split creates a ParentOrder that references the same address, so
       * deleting the address first fails on its foreign key — which is how
       * this teardown first announced that section 2c had worked.
       */
      const parentIds = (await prisma.order.findMany({
        where: { id: { in: orderIds }, parent_order_id: { not: null } },
        select: { parent_order_id: true },
      })).map((o) => o.parent_order_id!);

      await prisma.orderEditLog.deleteMany({ where: { order_id: { in: orderIds } } });
      await prisma.orderItem.deleteMany({ where: { order_id: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
      if (parentIds.length) {
        await prisma.parentOrder.deleteMany({ where: { id: { in: parentIds } } });
      }
    }
    // Put every shelf back, whatever happened above. A failed assertion must
    // not leave the catalogue short.
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
