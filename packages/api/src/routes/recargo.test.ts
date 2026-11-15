// ─── Integration test · recargo de equivalencia ─────────
//
// Run:  cd packages/api && npm run test:recargo
//
// User, 2026-11-04: a customer legally under the regime pays a surcharge on
// top of IVA, on the SAME taxable base (never on the IVA): 0,5 / 1,4 / 5,2 %
// for 4 / 10 / 21 % IVA, none at 0 %. Charged on the order; set by an admin
// on the customer; never applied just because someone is autónomo or has a
// NIF.
//
// Every figure below is worked by hand from those rates, not from the code:
//
//   rice   10 % · base 10,00 → 11,00 charged · recargo 1,4 % of 10,00 = 0,14
//   tool   21 % · base 20,00 → 24,20         · 5,2 % of 20,00        = 1,04
//   bread   4 % · base  5,00 →  5,20         · 0,5 % of 5,00 = 0,025 → 0,03
//   water   0 % · base  3,00 →  3,00         · none
//                                             recargo 1,21 on 43,40
//   + a 4,00 delivery fee (21 %): the 21 % base becomes 28,20 charged
//     − 4,89 IVA = 23,31 → 5,2 % = 1,2121 → 1,21; recargo 0,14 + 1,21 + 0,03
//     = 1,38; total 43,40 + 4,00 + 1,38 = 48,78
//   + rice to 3: 10 % base 30,00 → 0,42; recargo 1,66; total 65,40 + 4 + 1,66
//     = 71,06
import http from 'http';
import { Prisma } from '@prisma/client';
import app from '../server';
import prisma from '../lib/prisma';
import { generateAccessToken, generateAdminAccessToken } from '../lib/jwt';
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
const money = (v: unknown) => Number(v).toFixed(2);

async function main() {
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

  const userIds: string[] = [];
  const productIds: string[] = [];
  let categoryId = '';

  const call = async (path: string, token: string, init: { method?: string; body?: unknown } = {}) => {
    const res = await fetch(`${base}${path}`, {
      method: init.method ?? 'GET',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: res.status, body: await res.json().catch(() => null) as { success: boolean; error?: string; data?: any } };
  };

  try {
    const admin = await prisma.admin.findFirst({ where: { role: 'super_admin' }, select: { id: true, email: true, role: true } });
    if (!admin) { console.log('  SKIP  no super admin'); return; }
    const adminToken = generateAdminAccessToken({ adminId: admin.id, email: admin.email, role: admin.role });

    categoryId = (await prisma.category.create({
      data: { name_es: `RE ${stamp}`, name_en: `RE ${stamp}`, sort_order: 9999 }, select: { id: true },
    })).id;
    const make = async (name: string, price: string, band: 'zero' | 'super_reduced' | 'reduced' | 'general') => {
      const p = await prisma.product.create({
        data: {
          name_es: `${name} ${stamp}`, name_en: `${name} ${stamp}`, category_id: categoryId, is_active: true,
          vat_category: band, vat_category_reviewed: true,
          variants: { create: [{ name_es: '1 ud', name_en: '1 unit', price: new Prisma.Decimal(price), stock_quantity: 50, is_active: true, is_default: true }] },
        },
        include: { variants: true },
      });
      productIds.push(p.id);
      return p.variants[0];
    };
    const rice = await make('Arroz RE', '10.00', 'reduced');
    const tool = await make('Fregona RE', '20.00', 'general');
    const bread = await make('Pan RE', '5.00', 'super_reduced');
    const water = await make('Agua RE', '3.00', 'zero');

    const shop = await prisma.user.create({
      data: { name: `QA Tienda RE ${stamp}`, email: `qa.recargo.${stamp}@cesto.test`, tax_id: 'B12345678', is_business: true },
      select: { id: true, email: true, recargo_equivalencia: true },
    });
    userIds.push(shop.id);
    const address = await prisma.address.create({
      data: { user_id: shop.id, contact_name: 'QA', contact_phone: '600000009', street_line_1: 'C/ Recargo 1', postcode: '28016', city: 'Madrid', province: 'Madrid' },
      select: { id: true },
    });
    const basket = [
      { variant_id: rice.id, quantity: 1 }, { variant_id: tool.id, quantity: 1 },
      { variant_id: bread.id, quantity: 1 }, { variant_id: water.id, quantity: 1 },
    ];
    const build = (fee = 0) => call('/api/admin/orders', adminToken, {
      method: 'POST', body: { user_id: shop.id, address_id: address.id, delivery_fee: fee, items: basket },
    });

    // ─── 1. Not under the regime: nothing charged ──────────
    check('a customer starts NOT under the regime', shop.recargo_equivalencia === false);
    const plain = await build();
    const plainOrder = plain.body.data?.order;
    check('...and their order carries no recargo: total = subtotal = 43,40',
      plain.status === 201 && money(plainOrder?.recargo) === '0.00' && money(plainOrder?.total) === '43.40' && plainOrder?.recargo_equivalencia === false,
      { status: plain.status, error: plain.body?.error, recargo: plainOrder?.recargo, total: plainOrder?.total });

    // ─── 2. The office puts them under it ──────────────────
    const on = await call(`/api/admin/users/${shop.id}`, adminToken, { method: 'PUT', body: { recargo_equivalencia: true } });
    check('an admin turns recargo de equivalencia on for the customer', on.status === 200 && on.body.data?.recargo_equivalencia === true,
      { status: on.status, error: on.body?.error });

    // ─── 3. Charged on the order ───────────────────────────
    const re = await build();
    const order = re.body.data?.order;
    check('the order is under the regime and charged recargo 1,21 (0,14 + 1,04 + 0,03 + 0)',
      re.status === 201 && order?.recargo_equivalencia === true && money(order?.recargo) === '1.21',
      { status: re.status, error: re.body?.error, recargo: order?.recargo });
    check('...on top of IVA: total 43,40 + 1,21 = 44,61', money(order?.total) === '44.61', order?.total);
    check('...and the earlier order keeps what it was charged',
      money((await prisma.order.findUnique({ where: { id: plainOrder.id }, select: { recargo: true } }))?.recargo) === '0.00');

    // ─── 4. The delivery fee is part of its base ───────────
    const fee = await call(`/api/admin/orders/${order.id}/delivery-fee`, adminToken, { method: 'PUT', body: { delivery_fee: 4 } });
    check('a 4,00 fee (21 %) adds its own recargo: 1,38 in all, total 48,78',
      fee.status === 200 && money(fee.body.data?.recargo) === '1.38' && money(fee.body.data?.total) === '48.78',
      { status: fee.status, error: fee.body?.error, data: fee.body.data });

    // ─── 5. An edit re-charges it ──────────────────────────
    const fresh = await prisma.order.findUnique({ where: { id: order.id }, select: { items: { select: { id: true, variant_id: true } } } });
    const riceItem = fresh!.items.find((i) => i.variant_id === rice.id)!;
    const edit = await call(`/api/admin/orders/${order.id}/items`, adminToken, {
      method: 'PUT', body: { operations: [{ action: 'update_qty', order_item_id: riceItem.id, new_quantity: 3 }] },
    });
    const afterEdit = await prisma.order.findUnique({ where: { id: order.id }, select: { subtotal: true, recargo: true, total: true } });
    check('raising the rice to 3 re-charges recargo on what the order holds: 1,66, total 71,06',
      edit.status === 200 && money(afterEdit?.subtotal) === '65.40' && money(afterEdit?.recargo) === '1.66' && money(afterEdit?.total) === '71.06',
      { status: edit.status, error: edit.body?.error, afterEdit });

    // ─── 6. The factura states it, and adds up to what was paid ─
    const drafted = await call(`/api/admin/orders/${order.id}/invoice`, adminToken, { method: 'POST', body: { kind: 'invoice' } });
    const invoiceId = drafted.body.data?.invoice?.id as string | undefined;
    const doc = invoiceId ? (await call(`/api/admin/invoices/${invoiceId}`, adminToken)).body.data?.invoice : null;
    const by = Object.fromEntries((doc?.totals?.by_rate ?? []).map((g: { rate_pct: number }) => [g.rate_pct, g]));
    check('the factura charges recargo per rate: 10 % → 1,4 % 0,42; 21 % → 5,2 % 1,21; 4 % → 0,5 % 0,03; 0 % → none',
      by[10]?.recargo === '0.42' && by[10]?.recargo_pct === 1.4 && by[21]?.recargo === '1.21' && by[21]?.recargo_pct === 5.2
        && by[4]?.recargo === '0.03' && by[4]?.recargo_pct === 0.5 && (by[0]?.recargo ?? '0.00') === '0.00',
      doc?.totals?.by_rate);
    check('...its recargo 1,66 and total 71,06 are exactly what the order was charged',
      doc?.recargo_equivalencia === true && doc?.totals?.recargo === '1.66' && money(doc?.recargo_total) === '1.66'
        && doc?.totals?.total === '71.06' && money(doc?.total) === '71.06',
      { recargo: doc?.totals?.recargo, total: doc?.totals?.total, stored: doc?.total });
    check('...on the base, not on the IVA: base + IVA + recargo = total',
      Math.abs(Number(doc?.totals?.base) + Number(doc?.totals?.vat) + Number(doc?.totals?.recargo) - Number(doc?.totals?.total)) < 0.005,
      doc?.totals);

    // ─── 7. The bill (Nota) too ────────────────────────────
    const bill = (await call(`/api/admin/orders/${order.id}/bill`, adminToken)).body.data;
    check('the bill shows the recargo and the same total', bill?.recargo === '1.66' && bill?.total === '71.06', bill);

    // ─── 8. The customer's own checkout ────────────────────
    const shopToken = generateAccessToken({ userId: shop.id, email: shop.email ?? "" });
    await prisma.cartItem.createMany({
      data: [
        { user_id: shop.id, product_id: productIds[0], variant_id: rice.id, quantity: 1 },
        { user_id: shop.id, product_id: productIds[1], variant_id: tool.id, quantity: 1 },
      ],
    });
    const quote = await call('/api/orders/quote', shopToken, { method: 'POST', body: { addressId: address.id } });
    check('the checkout quote shows the recargo (0,14 + 1,04 = 1,18) inside its total (35,20 + 1,18 = 36,38)',
      quote.status === 200 && quote.body.data?.recargo === '1.18' && money(quote.body.data?.total) === '36.38',
      { status: quote.status, error: quote.body?.error, recargo: quote.body.data?.recargo, total: quote.body.data?.total });
    const placed = await call('/api/orders', shopToken, { method: 'POST', body: { addressId: address.id, paymentMethod: 'cod' } });
    const placedId = placed.body.data?.orders?.[0]?.id ?? placed.body.data?.order?.id ?? placed.body.data?.id;
    const own = placedId ? await prisma.order.findUnique({ where: { id: placedId }, select: { recargo_equivalencia: true, recargo: true, total: true } }) : null;
    check('...and checkout charges it: recargo 1,18, total 36,38',
      placed.status === 201 && own?.recargo_equivalencia === true && money(own?.recargo) === '1.18' && money(own?.total) === '36.38',
      { status: placed.status, error: placed.body?.error, own, keys: Object.keys(placed.body.data ?? {}) });

    // ─── 9. Off again: new orders are not charged; old ones keep theirs ─
    await call(`/api/admin/users/${shop.id}`, adminToken, { method: 'PUT', body: { recargo_equivalencia: false } });
    const after = await build();
    check('switched off, the next order carries none',
      after.status === 201 && money(after.body.data?.order?.recargo) === '0.00' && money(after.body.data?.order?.total) === '43.40');
    check('...and the order placed under it keeps its 1,66',
      money((await prisma.order.findUnique({ where: { id: order.id }, select: { recargo: true } }))?.recargo) === '1.66');

    // ─── 10. A split purchase: charged once, on the whole ──
    //   part A rice 11,00 (10 %), part B tool 24,20 (21 %), fee 4,00 (21 %)
    //   recargo 0,14 + 5,2 % of (28,20 − 4,89 = 23,31) 1,21 = 1,35
    //   total 35,20 + 4,00 + 1,35 = 40,55 — the parts carry none of it
    const line = (v: { id: string; product_id: string }, price: string, rate: number) => ({
      product_id: v.product_id, variant_id: v.id, quantity: 1, unit_price: new Prisma.Decimal(price),
      line_total: new Prisma.Decimal(price), tax_rate_pct: rate, product_snapshot: { name_es: `RE ${stamp}` },
    });
    const purchase = await prisma.parentOrder.create({
      data: {
        order_number: generateParentOrderNumber(), user_id: shop.id, address_id: address.id, payment_method: 'cod',
        address_snapshot: {}, subtotal: new Prisma.Decimal('35.20'), delivery_fee_total: new Prisma.Decimal(0),
        total: new Prisma.Decimal('35.20'), recargo_equivalencia: true,
      },
      select: { id: true },
    });
    for (const [v, price, rate] of [[rice, '11.00', 10], [tool, '24.20', 21]] as const) {
      await prisma.order.create({
        data: {
          order_number: generateOrderNumber(), user_id: shop.id, address_id: address.id, address_snapshot: {},
          payment_method: 'cod', parent_order_id: purchase.id, recargo_equivalencia: true,
          subtotal: new Prisma.Decimal(price), delivery_fee: new Prisma.Decimal(0), total: new Prisma.Decimal(price),
          items: { create: [line(v as { id: string; product_id: string }, price, rate)] },
        },
      });
    }
    const pfee = await call(`/api/admin/orders/${purchase.id}/delivery-fee`, adminToken, { method: 'PUT', body: { delivery_fee: 4 } });
    const restated = await prisma.parentOrder.findUnique({ where: { id: purchase.id }, select: { recargo: true, total: true } });
    const parts = await prisma.order.findMany({ where: { parent_order_id: purchase.id }, select: { recargo: true } });
    check('a split purchase is charged recargo once, on the whole: 1,35, total 40,55; its parts carry none',
      pfee.status === 200 && money(restated?.recargo) === '1.35' && money(restated?.total) === '40.55'
        && parts.every((p) => money(p.recargo) === '0.00'),
      { status: pfee.status, error: pfee.body?.error, restated, parts });
    const pdraft = await call(`/api/admin/orders/${purchase.id}/invoice`, adminToken, { method: 'POST', body: { kind: 'invoice' } });
    const pdoc = pdraft.body.data?.invoice?.id
      ? (await call(`/api/admin/invoices/${pdraft.body.data.invoice.id}`, adminToken)).body.data?.invoice : null;
    const pbill = (await call(`/api/admin/orders/${purchase.id}/bill`, adminToken)).body.data;
    check('...its one factura and its bill state the same 1,35 and 40,55',
      pdoc?.totals?.recargo === '1.35' && pdoc?.totals?.total === '40.55' && pbill?.recargo === '1.35' && pbill?.total === '40.55',
      { doc: pdoc?.totals, bill: pbill && { recargo: pbill.recargo, total: pbill.total } });

    // ─── 11. Put under the regime AFTER ordering ───────────
    // (the switch is off again here, since section 9)
    const early = (await build()).body.data?.order;
    const earlyDraft = await call(`/api/admin/orders/${early.id}/invoice`, adminToken, { method: 'POST', body: { kind: 'invoice' } });
    const earlyDocId = earlyDraft.body.data?.invoice?.id as string;
    // The office edits the factura by hand first (a typed note on a line), so it no longer follows the order.
    const earlyDoc = (await call(`/api/admin/invoices/${earlyDocId}`, adminToken)).body.data?.invoice;
    await call(`/api/admin/invoices/${earlyDocId}`, adminToken, {
      method: 'PUT',
      body: {
        lines: earlyDoc.lines.map((l: { description: string; quantity: number; unit_price: string; rate_pct: number; product_id: string | null; key: string }) => ({
          description: `${l.description} (revisado)`, quantity: l.quantity, unit_price: l.unit_price, rate_pct: l.rate_pct,
          product_id: l.product_id, key: l.key,
        })),
      },
    });
    const addOne = await call(`/api/admin/orders/${early.id}/recargo`, adminToken, { method: 'PUT', body: { on: true } });
    check('AN ORDER PLACED BEFORE THE SWITCH can have recargo added: 1,21, total 44,61',
      addOne.status === 200 && money(addOne.body.data?.recargo) === '1.21' && money(addOne.body.data?.total) === '44.61',
      { status: addOne.status, error: addOne.body?.error, data: addOne.body.data });
    const earlyAfter = (await call(`/api/admin/invoices/${earlyDocId}`, adminToken)).body.data?.invoice;
    check('...and its factura draft — even one edited by hand — follows: recargo 1,21, total 44,61',
      earlyAfter?.recargo_equivalencia === true && earlyAfter?.totals?.recargo === '1.21' && earlyAfter?.totals?.total === '44.61'
        && earlyAfter?.lines?.[0]?.description?.includes('(revisado)'),
      { recargo: earlyAfter?.totals?.recargo, total: earlyAfter?.totals?.total });
    const offOne = await call(`/api/admin/orders/${early.id}/recargo`, adminToken, { method: 'PUT', body: { on: false } });
    check('...and taken off again: recargo 0, total back to 43,40',
      offOne.status === 200 && money(offOne.body.data?.recargo) === '0.00' && money(offOne.body.data?.total) === '43.40');

    // Turning the customer on WITH their open orders.
    const waiting = (await build()).body.data?.order;
    const both = await call(`/api/admin/users/${shop.id}`, adminToken, { method: 'PUT', body: { recargo_equivalencia: true, apply_to_open_orders: true } });
    const waitingAfter = await prisma.order.findUnique({ where: { id: waiting.id }, select: { recargo: true, total: true, recargo_equivalencia: true } });
    check('turning the customer on "with their open orders" adds it to the order already waiting (1,21)',
      both.status === 200 && (both.body.data?.applied_to_open_orders?.changed ?? 0) >= 1
        && waitingAfter?.recargo_equivalencia === true && money(waitingAfter?.recargo) === '1.21' && money(waitingAfter?.total) === '44.61',
      { status: both.status, applied: both.body.data?.applied_to_open_orders, waitingAfter });

    // Not once it is delivered, nor once a factura is issued.
    await prisma.order.update({ where: { id: waiting.id }, data: { status: 'delivered' } });
    const late = await call(`/api/admin/orders/${waiting.id}/recargo`, adminToken, { method: 'PUT', body: { on: false } });
    check('a delivered order refuses the change (422)', late.status === 422, { status: late.status, error: late.body?.error });
    const issued = await call(`/api/admin/invoices/${earlyDocId}/issue`, adminToken, { method: 'POST' });
    const lockedChange = await call(`/api/admin/orders/${early.id}/recargo`, adminToken, { method: 'PUT', body: { on: true } });
    check('an order with an issued factura refuses it (409)', issued.status === 200 && lockedChange.status === 409,
      { issued: issued.status, status: lockedChange.status, error: lockedChange.body?.error });

    // A part of a split purchase changes the whole purchase.
    const partId = (await prisma.order.findFirst({ where: { parent_order_id: purchase.id }, select: { id: true } }))!.id;
    const partOff = await call(`/api/admin/orders/${partId}/recargo`, adminToken, { method: 'PUT', body: { on: false } });
    const purchaseOff = await prisma.parentOrder.findUnique({ where: { id: purchase.id }, select: { recargo: true, total: true, recargo_equivalencia: true } });
    check('asking on a part of a split purchase takes it off the whole purchase: 0, total 39,20',
      partOff.status === 200 && partOff.body.data?.kind === 'purchase' && purchaseOff?.recargo_equivalencia === false
        && money(purchaseOff?.recargo) === '0.00' && money(purchaseOff?.total) === '39.20',
      { status: partOff.status, error: partOff.body?.error, purchaseOff });
  } finally {
    if (userIds.length) {
      const orders = await prisma.order.findMany({ where: { user_id: { in: userIds } }, select: { id: true } });
      const ids = orders.map((o) => o.id);
      await prisma.$executeRawUnsafe('ALTER TABLE invoices DISABLE TRIGGER invoices_no_mutate_issued');
      await prisma.$executeRawUnsafe('ALTER TABLE invoices DISABLE TRIGGER invoices_no_delete_issued');
      try {
        await prisma.invoice.deleteMany({ where: { user_id: { in: userIds } } });
      } finally {
        await prisma.$executeRawUnsafe('ALTER TABLE invoices ENABLE TRIGGER invoices_no_mutate_issued');
        await prisma.$executeRawUnsafe('ALTER TABLE invoices ENABLE TRIGGER invoices_no_delete_issued');
      }
      await prisma.orderEditLog.deleteMany({ where: { order_id: { in: ids } } });
      await prisma.orderItem.deleteMany({ where: { order_id: { in: ids } } });
      await prisma.orderIdempotency.deleteMany({ where: { order_id: { in: ids } } }).catch(() => {});
      await prisma.order.deleteMany({ where: { id: { in: ids } } });
      await prisma.parentOrder.deleteMany({ where: { user_id: { in: userIds } } });
      await prisma.cartItem.deleteMany({ where: { user_id: { in: userIds } } });
      await prisma.customerProductDiscount.deleteMany({ where: { user_id: { in: userIds } } }).catch(() => {});
      await prisma.notification.deleteMany({ where: { user_id: { in: userIds } } }).catch(() => {});
      await prisma.address.deleteMany({ where: { user_id: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    if (productIds.length) {
      await prisma.productVariant.deleteMany({ where: { product_id: { in: productIds } } });
      await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    }
    if (categoryId) await prisma.category.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
    server.close();
  }

  console.log(`\n${passed}/${passed + failed} passed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
