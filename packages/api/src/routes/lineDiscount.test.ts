// ─── Integration test · a discount agreed at the counter ───────────────────
//
// Run:  cd packages/api && npm run test:line-discount
//
// A rep standing in a shop knocks two euros off a line and reads out the new
// total. Until 2026-10-10 they could not: the discount control existed only
// on the EDIT screen, so the order went in at full price and was corrected
// afterwards — which wrote the discount into the order's edit log as though
// they had changed their mind, and left the customer looking at the wrong
// figure in between.
//
// Both builders now send a discount AT CREATION, through admin's route and
// the rep's. Three things have to hold for that to be worth anything, and
// none of them is visible from the screens:
//
//   · the figure is STORED on the line and taken off its total, so the
//     invoice and the IVA split (which read `line_total`) agree with it;
//   · A LINE CREATED WITH A DISCOUNT COSTS EXACTLY WHAT THE SAME LINE COSTS
//     AFTER AN EDIT — two code paths, one of them brand new, and a cent of
//     disagreement here is an order that reconciles differently depending on
//     how it was built;
//   · over-discounting clamps at zero instead of going negative, because a
//     negative line would flow into the subtotal and out onto a factura.
//
// Goes through the real HTTP routes. Makes its own rep, client and orders,
// and puts back every unit of stock it took.
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
/** Flat euros off the line — never a percentage, never per unit. */
const OFF = 1.5;

/** Cents, so nothing in here compares floats. */
const cents = (v: unknown) => Math.round(Number(v) * 100);

async function main() {
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

  const userIds: string[] = [];
  const orderIds: string[] = [];
  /** variant id -> units this test removed from stock. */
  const taken = new Map<string, number>();

  const call = async (path: string, init: { method?: string; body?: unknown; token: string }) => {
    const res = await fetch(`${base}${path}`, {
      method: init.method ?? 'GET',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${init.token}` },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    return {
      status: res.status,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      body: await res.json() as { success: boolean; error?: string; data?: any },
    };
  };

  const note = (variantId: string, units: number) =>
    taken.set(variantId, (taken.get(variantId) ?? 0) + units);

  /**
   * Lines the dev mailer printed while `fn` ran, waited for.
   *
   * The notification is fired with `void` - the route answers without it - so
   * the log arrives after the response. Polling for it is what makes the
   * assertion about the email possible at all from out here.
   */
  const mailLinesDuring = async (fn: () => Promise<unknown>, match: RegExp, ms = 3000) => {
    const seen: string[] = [];
    const real = console.log;
    console.log = (...args: unknown[]) => {
      seen.push(args.map(String).join(' '));
      real(...(args as []));
    };
    try {
      await fn();
      const until = Date.now() + ms;
      while (Date.now() < until) {
        const hit = seen.find((l) => match.test(l));
        if (hit) return hit;
        await new Promise((r) => setTimeout(r, 50));
      }
      return seen.find((l) => match.test(l));
    } finally {
      console.log = real;
    }
  };

  try {
    // ─── Fixtures ────────────────────────────────────────────
    //
    // Real catalogue rows: the price the order is written with comes from the
    // variant, never from the request, so the arithmetic below has to be
    // computed from whatever these cost rather than from a figure chosen here.
    // A rep sells from one shop (lib/repStore): the products come from one, and the rep is given it.
    const shopId = await busiestShop({ stock_quantity: { gte: QTY * 6 }, price: { gt: 5 } });
    const variants = await prisma.productVariant.findMany({
      where: {
        is_active: true,
        product: { is_active: true, store_id: shopId },
        stock_quantity: { gte: QTY * 6 },
        price: { gt: 5 },
      },
      select: { id: true, price: true },
      take: 2,
    });
    if (variants.length < 2) {
      console.log(`  SKIP  only ${variants.length} priced variants with stock to work with`);
      return;
    }
    const [v1, v2] = variants;
    const unit1 = Number(v1.price);
    const unit2 = Number(v2.price);
    const gross1 = unit1 * QTY;
    console.log(`  ..    line A ${QTY} x ${unit1.toFixed(2)}, line B 1 x ${unit2.toFixed(2)}\n`);

    const admin = await prisma.admin.findFirst({ select: { id: true, email: true, role: true } });
    if (!admin) { console.log('  SKIP  no admin row to act as'); return; }
    const adminToken = generateAdminAccessToken({
      adminId: admin.id, email: admin.email, role: admin.role,
    });

    const rep = await prisma.user.create({
      data: { name: `QA Disc ${stamp}`, email: `qa.disc.${stamp}@cesto.test` },
    });
    userIds.push(rep.id);
    await prisma.salesRep.create({ data: { user_id: rep.id, is_active: true, ...repShop(shopId) } });
    const repToken = generateAccessToken({ userId: rep.id, email: rep.email ?? undefined });

    const client = await prisma.user.create({
      data: {
        name: `QA DiscClient ${stamp}`, email: `qa.discclient.${stamp}@cesto.test`,
        created_by_sales_rep_id: rep.id,
      },
    });
    userIds.push(client.id);
    const address = await prisma.address.create({
      data: {
        user_id: client.id, contact_name: 'QA', contact_phone: '600000002',
        street_line_1: 'C/ Descuento 1', postcode: '28016', city: 'Madrid', province: 'Madrid',
      },
      select: { id: true },
    });

    const basket = (discount?: number) => ({
      user_id: client.id,
      address_id: address.id,
      delivery_fee: 0,
      items: [
        { variant_id: v1.id, quantity: QTY, ...(discount !== undefined ? { discount_amount: discount } : {}) },
        { variant_id: v2.id, quantity: 1 },
      ],
    });

    const linesOf = async (orderId: string) => prisma.orderItem.findMany({
      where: { order_id: orderId },
      select: { variant_id: true, quantity: true, unit_price: true, discount_amount: true, line_total: true },
    });

    // ─── 1. ADMIN creates a discounted order ─────────────────
    const a = await call('/api/admin/orders', { method: 'POST', token: adminToken, body: basket(OFF) });
    check('admin can create an order with a discount on it', a.status === 201,
      { status: a.status, error: a.body.error });
    const adminOrderId = a.body.data?.order?.id as string | undefined;
    if (!adminOrderId) { console.log('  ABORT  no order to read'); return; }
    orderIds.push(adminOrderId);
    note(v1.id, QTY); note(v2.id, 1);

    const aLines = await linesOf(adminOrderId);
    const aDiscounted = aLines.find((l) => l.variant_id === v1.id)!;
    const aPlain = aLines.find((l) => l.variant_id === v2.id)!;

    check('...and the figure is stored on the line', cents(aDiscounted.discount_amount) === cents(OFF),
      { got: aDiscounted.discount_amount });
    check('...and taken off what the line costs',
      cents(aDiscounted.line_total) === cents(gross1 - OFF),
      { got: aDiscounted.line_total, want: (gross1 - OFF).toFixed(2) });
    check('...while the price per unit is untouched, so the invoice still shows it',
      cents(aDiscounted.unit_price) === cents(unit1), { got: aDiscounted.unit_price });

    // Null, not zero. The edit log keeps "never discounted" and "discounted by
    // nothing" apart, and a line the rep never touched is the first of those.
    check('an undiscounted line in the same basket stays NULL, not 0',
      aPlain.discount_amount === null, { got: aPlain.discount_amount });

    const aOrder = await prisma.order.findUnique({
      where: { id: adminOrderId }, select: { subtotal: true, total: true, delivery_fee: true },
    });
    check('the order subtotal is NET of the discount',
      cents(aOrder?.subtotal) === cents(gross1 - OFF + unit2),
      { got: aOrder?.subtotal, want: (gross1 - OFF + unit2).toFixed(2) });
    check('...and the total follows it',
      cents(aOrder?.total) === cents(gross1 - OFF + unit2) + cents(aOrder?.delivery_fee),
      { total: aOrder?.total, fee: aOrder?.delivery_fee });

    // ─── 2. A REP gets the same arithmetic ───────────────────
    //
    // Same shared function underneath, but a separate route with its own
    // schema — the rep's omits admin_notes, and a schema that strips
    // `discount_amount` would be silent on screen and only visible here.
    const r = await call('/api/sales/orders', { method: 'POST', token: repToken, body: basket(OFF) });
    check('a rep can create an order with a discount on it', r.status === 201,
      { status: r.status, error: r.body.error });
    const repOrderId = r.body.data?.order?.id as string | undefined;
    if (!repOrderId) { console.log('  ABORT  no rep order to read'); return; }
    orderIds.push(repOrderId);
    note(v1.id, QTY); note(v2.id, 1);

    const rLines = await linesOf(repOrderId);
    const rDiscounted = rLines.find((l) => l.variant_id === v1.id)!;
    check('...stored and applied exactly as admin\'s was',
      cents(rDiscounted.discount_amount) === cents(OFF)
      && cents(rDiscounted.line_total) === cents(aDiscounted.line_total),
      { discount: rDiscounted.discount_amount, line: rDiscounted.line_total });

    // ─── 3. CREATED WITH IT === EDITED TO IT ─────────────────
    //
    // The claim that matters. One line discounted on the way in, the same line
    // discounted afterwards by the edit path, and nothing may differ.
    const plainOrder = await call('/api/sales/orders', {
      method: 'POST', token: repToken, body: basket(),
    });
    const plainId = plainOrder.body.data?.order?.id as string | undefined;
    if (!plainId) { console.log('  ABORT  no undiscounted order to edit'); return; }
    orderIds.push(plainId);
    note(v1.id, QTY); note(v2.id, 1);

    const plainLines = await prisma.orderItem.findMany({
      where: { order_id: plainId }, select: { id: true, variant_id: true, line_total: true },
    });
    const toDiscount = plainLines.find((l) => l.variant_id === v1.id)!;
    check('it goes in at full price with no discount asked for',
      cents(toDiscount.line_total) === cents(gross1), { got: toDiscount.line_total });

    let edited!: { status: number; body: { success: boolean; error?: string } };
    const mailLine = await mailLinesDuring(
      async () => {
        edited = await call(`/api/sales/orders/${plainId}/items`, {
          method: 'PUT', token: repToken,
          body: { operations: [{ action: 'set_discount', order_item_id: toDiscount.id, discount_amount: OFF }] },
        });
      },
      /\[mail:order-edited\]/,
    );
    check('the same discount can be applied by an edit', edited.status === 200,
      { status: edited.status, error: edited.body.error });

    // ─── The email the customer actually receives ────────────
    //
    // It prints "Nuevo total del pedido" from `newTotal`, which neither the
    // rep route nor the admin route passed - so the default of 0 went out,
    // and every edit made from either screen told the customer their order
    // now came to nothing. A discount is precisely when they read that line.
    const mailedTotal = /newTotal=([\d.]+)/.exec(mailLine ?? '')?.[1];
    const expectedTotal = await prisma.order.findUnique({
      where: { id: plainId }, select: { total: true },
    });
    check('the edited-order email states the REAL new total, not 0',
      mailedTotal !== undefined && cents(mailedTotal) === cents(expectedTotal?.total),
      { mailed: mailedTotal, order: expectedTotal?.total, line: mailLine });

    const afterEdit = await prisma.orderItem.findUnique({
      where: { id: toDiscount.id },
      select: { discount_amount: true, line_total: true },
    });
    check('A LINE CREATED WITH A DISCOUNT COSTS WHAT AN EDITED ONE COSTS',
      cents(afterEdit?.line_total) === cents(rDiscounted.line_total),
      { created: rDiscounted.line_total, edited: afterEdit?.line_total });
    check('...and carries the same figure', cents(afterEdit?.discount_amount) === cents(OFF),
      { got: afterEdit?.discount_amount });

    const [createdOrder, editedOrder] = await Promise.all([
      prisma.order.findUnique({ where: { id: repOrderId }, select: { subtotal: true, total: true } }),
      prisma.order.findUnique({ where: { id: plainId }, select: { subtotal: true, total: true } }),
    ]);
    check('...so the two orders reconcile to the same money',
      cents(createdOrder?.subtotal) === cents(editedOrder?.subtotal)
      && cents(createdOrder?.total) === cents(editedOrder?.total),
      { created: createdOrder, edited: editedOrder });

    // ─── 4. Clearing it puts the line back ───────────────────
    const cleared = await call(`/api/sales/orders/${plainId}/items`, {
      method: 'PUT', token: repToken,
      body: { operations: [{ action: 'set_discount', order_item_id: toDiscount.id, discount_amount: 0 }] },
    });
    check('a discount can be taken back off', cleared.status === 200,
      { status: cleared.status, error: cleared.body.error });
    const unwound = await prisma.orderItem.findUnique({
      where: { id: toDiscount.id }, select: { line_total: true },
    });
    check('...and the line is back at full price', cents(unwound?.line_total) === cents(gross1),
      { got: unwound?.line_total, want: gross1.toFixed(2) });

    // ─── 5. More off than the line is worth ──────────────────
    //
    // Honest, not abuse: take five euros off a line, then drop the quantity to
    // one. Refusing it would be the wrong answer, so it clamps — and a clamp
    // that only one of the two paths applies is the bug this pins down.
    const tooMuch = Math.ceil(gross1) + 10;
    const over = await call('/api/admin/orders', {
      method: 'POST', token: adminToken, body: basket(tooMuch),
    });
    check('a discount bigger than the line is accepted, not refused', over.status === 201,
      { status: over.status, error: over.body.error });
    const overId = over.body.data?.order?.id as string | undefined;
    if (overId) {
      orderIds.push(overId);
      note(v1.id, QTY); note(v2.id, 1);
      const overLines = await linesOf(overId);
      const freeLine = overLines.find((l) => l.variant_id === v1.id)!;
      check('...and the line CLAMPS AT ZERO rather than going negative',
        cents(freeLine.line_total) === 0, { got: freeLine.line_total });
      const overOrder = await prisma.order.findUnique({
        where: { id: overId }, select: { subtotal: true },
      });
      check('...so the rest of the basket is still charged for',
        cents(overOrder?.subtotal) === cents(unit2),
        { got: overOrder?.subtotal, want: unit2.toFixed(2) });
    }

    // ─── 6. Junk never reaches the column ────────────────────
    const negative = await call('/api/admin/orders', {
      method: 'POST', token: adminToken, body: basket(-5),
    });
    // 422, not 400: validate() answers an unprocessable body that way, and
    // the admin client turns the field path into a readable line.
    check('a negative discount is refused outright', negative.status === 422,
      { status: negative.status, error: negative.body.error });
    check('...naming the field, so the screen can say which line',
      /discount_amount/.test(negative.body.error ?? ''), { error: negative.body.error });
    if (negative.status === 201 && negative.body.data?.order?.id) {
      orderIds.push(negative.body.data.order.id as string);
      note(v1.id, QTY); note(v2.id, 1);
    }

  } finally {
    if (orderIds.length) {
      await prisma.orderEditLog.deleteMany({ where: { order_id: { in: orderIds } } });
      await prisma.orderItem.deleteMany({ where: { order_id: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    // Deleting the orders does not restock — only cancelling does — so every
    // unit this test took goes back by hand. A test that quietly eats stock
    // from the dev catalogue makes the next one skip for want of it.
    for (const [variantId, units] of taken) {
      await prisma.productVariant.update({
        where: { id: variantId },
        data: { stock_quantity: { increment: units } },
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
