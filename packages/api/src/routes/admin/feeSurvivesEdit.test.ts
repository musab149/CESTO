// ─── Integration test · the delivery fee survives an edit ──────────────────
//
// Run:  cd packages/api && npm run test:fee-survives-edit
//
// A wholesale drop is not priced at checkout — the office puts the fee on
// afterwards, and the customer is told it is coming. So the fee is typed in by
// hand, once, and anything that silently drops it hands the customer a total
// that is missing the delivery and hands the admin the job again.
//
// editOrder's Pass 5 recomputed the purchase's `delivery_fee_total` by SUMMING
// its parts' fees. That was right while each part carried its share. Since the
// fee moved onto the purchase (one delivery, charged once) every part carries
// zero, so the sum wrote 0 over whatever the office had set — on every edit of
// every part. Price the purchase, change one line, and it was gone.
//
// The same line took the fee off plain orders, on the one edit where it
// mattered: an add from another shop turns a standalone order into the first
// part of a new purchase and moves its fee to that purchase, and Pass 5 ran
// straight afterwards and zeroed it.
//
// Four claims, all through the real admin routes:
//
//   · a part can be edited WITHOUT the purchase losing its fee;
//   · twice, without the fee drifting;
//   · a plain order keeps its own fee through an edit;
//   · a plain order that SPLITS carries its fee onto the purchase and keeps it.
import http from 'http';
import app from '../../server';
import prisma from '../../lib/prisma';
import { Prisma } from '@prisma/client';
import { generateAdminAccessToken } from '../../lib/jwt';
import { generateOrderNumber } from '../../lib/pagination';
import { generateParentOrderNumber } from '../../lib/parentOrder';
import { buildProductSnapshot } from '../../lib/orderTotals';

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
/** What the office charges for taking the whole package out. */
const FEE = 24.5;
/** What a plain order was quoted at checkout. */
const PLAIN_FEE = 7.5;

const cents = (v: unknown) => Math.round(Number(v) * 100);

async function main() {
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

  const userIds: string[] = [];
  const orderIds: string[] = [];
  const parentIds: string[] = [];
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
    // ─── Fixtures ────────────────────────────────────────────
    const variants = await prisma.productVariant.findMany({
      where: {
        is_active: true,
        product: { is_active: true, store_id: null },
        stock_quantity: { gte: 6 },
        price: { gt: 2 },
      },
      select: { id: true, name_es: true, name_en: true, price: true, product: { select: { id: true, name_es: true, name_en: true, store_id: true } } },
      take: 3,
    });
    // One from a PARTNER shop, which is what makes an add split the order.
    const foreign = await prisma.productVariant.findFirst({
      where: {
        is_active: true,
        product: { is_active: true, store_id: { not: null } },
        stock_quantity: { gte: 4 },
      },
      select: { id: true, product: { select: { store_id: true } } },
    });
    if (variants.length < 3 || !foreign) {
      console.log(`  SKIP  need 3 Cesto variants and 1 partner variant; found ${variants.length} and ${foreign ? 1 : 0}`);
      return;
    }

    const admin = await prisma.admin.findFirst({ select: { id: true, email: true, role: true } });
    if (!admin) { console.log('  SKIP  no admin row to act as'); return; }
    const token = generateAdminAccessToken({ adminId: admin.id, email: admin.email, role: admin.role });

    const user = await prisma.user.create({
      data: {
        name: `QA Fee ${stamp}`, email: `qa.fee.${stamp}@cesto.test`,
        is_business: true, pricing_mode: 'b2b',
      },
      select: { id: true },
    });
    userIds.push(user.id);
    const address = await prisma.address.create({
      data: {
        user_id: user.id, contact_name: 'QA', contact_phone: '600000005',
        street_line_1: 'C/ Envio 1', postcode: '28016', city: 'Madrid', province: 'Madrid',
      },
      select: { id: true },
    });

    // ─── A split purchase, as checkout leaves it ─────────────
    //
    // Two parts, each priced, neither carrying a fee. Built directly: this is
    // a STATE the test needs, not a path it is testing.
    const parent = await prisma.parentOrder.create({
      data: {
        order_number: generateParentOrderNumber(),
        user_id: user.id, address_id: address.id, payment_method: 'cod',
        address_snapshot: {},
        subtotal: new Prisma.Decimal(0),
        delivery_fee_total: new Prisma.Decimal(0),
        total: new Prisma.Decimal(0),
      },
      select: { id: true },
    });
    parentIds.push(parent.id);

    const partIds: string[] = [];
    let partsSubtotal = new Prisma.Decimal(0);
    for (const v of variants.slice(0, 2)) {
      const unit = v.price;
      partsSubtotal = partsSubtotal.plus(unit);
      const part = await prisma.order.create({
        data: {
          order_number: generateOrderNumber(),
          user_id: user.id, address_id: address.id, status: 'pending',
          payment_method: 'cod', parent_order_id: parent.id,
          address_snapshot: {},
          buyer_is_business: true,
          subtotal: unit,
          delivery_fee: new Prisma.Decimal(0),
          total: unit,
          items: {
            create: [{
              product_id: v.product.id,
              variant_id: v.id,
              product_snapshot: buildProductSnapshot({ ...v, product: { ...v.product, images: [] } }),
              quantity: 1,
              unit_price: unit,
              line_total: unit,
            }],
          },
        },
        select: { id: true },
      });
      partIds.push(part.id);
      orderIds.push(part.id);
    }
    await prisma.parentOrder.update({
      where: { id: parent.id },
      data: { subtotal: partsSubtotal, total: partsSubtotal },
    });

    // ─── 1. The office prices the whole purchase ─────────────
    const priced = await call(`/api/admin/orders/${parent.id}/delivery-fee`, {
      method: 'PUT', token, body: { delivery_fee: FEE },
    });
    check('the purchase can be priced', priced.status === 200,
      { status: priced.status, error: priced.body.error });
    check('...and carries the fee', cents(priced.body.data?.delivery_fee_total) === cents(FEE),
      { got: priced.body.data?.delivery_fee_total });

    const want = cents(partsSubtotal) + cents(FEE);
    check('...with the total to match', cents(priced.body.data?.total) === want,
      { got: priced.body.data?.total });

    // ─── 2. Now edit a part ──────────────────────────────────
    const firstItem = await prisma.orderItem.findFirst({
      where: { order_id: partIds[0] }, select: { id: true },
    });
    const edited = await call(`/api/admin/orders/${partIds[0]}/items`, {
      method: 'PUT', token,
      body: { operations: [{ action: 'set_discount', order_item_id: firstItem!.id, discount_amount: 1 }] },
    });
    check('a part of the purchase can be edited', edited.status === 200,
      { status: edited.status, error: edited.body.error });

    const afterEdit = await prisma.parentOrder.findUnique({
      where: { id: parent.id },
      select: { subtotal: true, delivery_fee_total: true, total: true },
    });
    check('THE PURCHASE STILL CARRIES ITS FEE AFTER THE EDIT',
      cents(afterEdit?.delivery_fee_total) === cents(FEE),
      { got: afterEdit?.delivery_fee_total, want: FEE });
    check('...the subtotal followed the change',
      cents(afterEdit?.subtotal) === cents(partsSubtotal) - 100,
      { got: afterEdit?.subtotal, want: Number(partsSubtotal) - 1 });
    check('...and the total is the goods PLUS the delivery',
      cents(afterEdit?.total) === cents(afterEdit?.subtotal) + cents(FEE),
      { total: afterEdit?.total, subtotal: afterEdit?.subtotal, fee: FEE });

    const partsAfter = await prisma.order.findMany({
      where: { id: { in: partIds } }, select: { delivery_fee: true },
    });
    check('...while every part still carries zero, charged once',
      partsAfter.every((o) => cents(o.delivery_fee) === 0),
      partsAfter.map((o) => Number(o.delivery_fee)));

    // ─── 3. And again, because a fee must not DRIFT ──────────
    //
    // A fix that added the parts' fees to the parent's own would look right
    // once and compound on every later edit.
    const secondItem = await prisma.orderItem.findFirst({
      where: { order_id: partIds[1] }, select: { id: true, variant_id: true },
    });
    const again = await call(`/api/admin/orders/${partIds[1]}/items`, {
      method: 'PUT', token,
      body: { operations: [{ action: 'update_qty', order_item_id: secondItem!.id, new_quantity: 2 }] },
    });
    check('a second edit, on the other part, succeeds', again.status === 200,
      { status: again.status, error: again.body.error });
    if (again.status === 200 && secondItem?.variant_id) taken.set(secondItem.variant_id, 1);

    const afterTwo = await prisma.parentOrder.findUnique({
      where: { id: parent.id },
      select: { subtotal: true, delivery_fee_total: true, total: true },
    });
    check('the fee is STILL exactly what was set — not doubled, not zero',
      cents(afterTwo?.delivery_fee_total) === cents(FEE),
      { got: afterTwo?.delivery_fee_total, want: FEE });
    check('...and the total still adds up',
      cents(afterTwo?.total) === cents(afterTwo?.subtotal) + cents(FEE),
      { total: afterTwo?.total, subtotal: afterTwo?.subtotal });

    // ─── 4. A PLAIN order keeps its own fee ──────────────────
    const plain = await call('/api/admin/orders', {
      method: 'POST', token,
      body: {
        user_id: user.id, address_id: address.id, delivery_fee: PLAIN_FEE,
        items: [{ variant_id: variants[2].id, quantity: 2 }],
      },
    });
    const plainId = plain.body.data?.order?.id as string | undefined;
    check('a plain order is created with a fee', plain.status === 201 && !!plainId,
      { status: plain.status, error: plain.body.error });
    if (!plainId) return;
    orderIds.push(plainId);
    taken.set(variants[2].id, (taken.get(variants[2].id) ?? 0) + 2);

    const plainItem = await prisma.orderItem.findFirst({
      where: { order_id: plainId }, select: { id: true },
    });
    await call(`/api/admin/orders/${plainId}/items`, {
      method: 'PUT', token,
      body: { operations: [{ action: 'set_discount', order_item_id: plainItem!.id, discount_amount: 2 }] },
    });
    const plainAfter = await prisma.order.findUnique({
      where: { id: plainId }, select: { subtotal: true, delivery_fee: true, total: true },
    });
    check('a plain order keeps its own fee through an edit',
      cents(plainAfter?.delivery_fee) === cents(PLAIN_FEE),
      { got: plainAfter?.delivery_fee, want: PLAIN_FEE });
    check('...and its total is the goods plus that fee',
      cents(plainAfter?.total) === cents(plainAfter?.subtotal) + cents(PLAIN_FEE),
      { total: plainAfter?.total, subtotal: plainAfter?.subtotal });

    // ─── 5. ...even when the edit SPLITS it ──────────────────
    //
    // Adding another shop's product turns this order into the first part of a
    // brand-new purchase. The fee moves to that purchase: the order itself
    // goes to zero (one delivery, charged once) and the figure must come out
    // the other side intact rather than being summed back to nothing.
    const split = await call(`/api/admin/orders/${plainId}/items`, {
      method: 'PUT', token,
      body: { operations: [{ action: 'add', new_variant_id: foreign.id, new_quantity: 1 }] },
    });
    check('an add from another shop is accepted', split.status === 200,
      { status: split.status, error: split.body.error });
    if (split.status === 200) taken.set(foreign.id, (taken.get(foreign.id) ?? 0) + 1);

    const splitOrder = await prisma.order.findUnique({
      where: { id: plainId },
      select: { parent_order_id: true, delivery_fee: true, subtotal: true, total: true },
    });
    check('...and it made the order part of a purchase',
      !!splitOrder?.parent_order_id, { parent: splitOrder?.parent_order_id });

    if (splitOrder?.parent_order_id) {
      parentIds.push(splitOrder.parent_order_id);
      const newParts = await prisma.order.findMany({
        where: { parent_order_id: splitOrder.parent_order_id, deleted_at: null },
        select: { id: true, subtotal: true, delivery_fee: true, total: true },
      });
      for (const p of newParts) if (!orderIds.includes(p.id)) orderIds.push(p.id);

      const newParent = await prisma.parentOrder.findUnique({
        where: { id: splitOrder.parent_order_id },
        select: { subtotal: true, delivery_fee_total: true, total: true },
      });
      check('THE FEE MOVED TO THE PURCHASE INSTEAD OF VANISHING',
        cents(newParent?.delivery_fee_total) === cents(PLAIN_FEE),
        { got: newParent?.delivery_fee_total, want: PLAIN_FEE });
      check('...the order itself now carries zero, like any other part',
        cents(splitOrder.delivery_fee) === 0, { got: splitOrder.delivery_fee });
      check('...and the purchase totals the parts plus the one fee',
        cents(newParent?.total)
          === newParts.reduce((s, p) => s + cents(p.total), 0) + cents(PLAIN_FEE),
        {
          total: newParent?.total,
          parts: newParts.map((p) => Number(p.total)),
          fee: PLAIN_FEE,
        });
    }

  } finally {
    if (orderIds.length) {
      await prisma.orderEditLog.deleteMany({ where: { order_id: { in: orderIds } } });
      await prisma.orderItem.deleteMany({ where: { order_id: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    if (parentIds.length) await prisma.parentOrder.deleteMany({ where: { id: { in: parentIds } } });
    for (const [variantId, units] of taken) {
      await prisma.productVariant.update({
        where: { id: variantId }, data: { stock_quantity: { increment: units } },
      });
    }
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
