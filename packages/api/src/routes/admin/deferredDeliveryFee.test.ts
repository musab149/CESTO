// ─── Integration test · wholesale delivery is deferred, not waived ─────────
//
// Run:  cd packages/api && npm run test:deferred-fee
//
// A b2b drop is a pallet on a route, not a consumer parcel, and no band
// ladder describes what it costs. So the storefront charges nothing at
// checkout and the OFFICE prices it afterwards.
//
// That only works if the second half actually happens, which is three
// separate claims and none of them is obvious from the checkout code:
//
//   · the order lands with zero AND is marked as a business purchase, which
//     is what every screen reads to say "not priced yet" instead of "Free";
//   · an admin can still put a fee on it — the fee routes refuse an order
//     that is invoiced, delivered or split, and a b2b order must not be
//     refused for simply being b2b;
//   · setting it RECOMPUTES THE TOTAL, because the customer is looking at
//     that number and was promised it would change.
//
// The last one is the whole point. A fee that saves but leaves the total
// behind gives the customer one figure and the books another.
//
// SINCE 2026-10-23 EVERY customer's own order works this way, not only a
// wholesale one (user decision): the quote and the checkout carry no fee, and
// whoever sets it tells the customer. Section 6.
import http from 'http';
import app from '../../server';
import prisma from '../../lib/prisma';
import { Prisma } from '@prisma/client';
import { generateAdminAccessToken, generateAccessToken } from '../../lib/jwt';
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
const SUBTOTAL = '240.00';
const FEE = 18.5;

async function main() {
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

  const userIds: string[] = [];
  const orderIds: string[] = [];
  const parentIds: string[] = [];

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
    const admin = await prisma.admin.findFirst({ select: { id: true, email: true, role: true } });
    if (!admin) { console.log('  SKIP  no admin row to act as'); return; }
    const token = generateAdminAccessToken({ adminId: admin.id, email: admin.email, role: admin.role });

    const user = await prisma.user.create({
      data: {
        name: `QA Wholesale ${stamp}`,
        email: `qa.wholesale.${stamp}@cesto.test`,
        is_business: true,
        pricing_mode: 'b2b',
      },
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

    // The state a wholesale checkout leaves behind: priced items, no fee.
    const order = await prisma.order.create({
      data: {
        order_number: generateOrderNumber(),
        user_id: user.id, address_id: address.id, status: 'pending',
        payment_method: 'cod',
        address_snapshot: {},
        buyer_is_business: true,
        subtotal: new Prisma.Decimal(SUBTOTAL),
        delivery_fee: new Prisma.Decimal(0),
        total: new Prisma.Decimal(SUBTOTAL),
      },
      select: { id: true },
    });
    orderIds.push(order.id);

    // ─── 1. What the screens read ────────────────────────────
    const before = await call(`/api/admin/orders/${order.id}`, { token });
    check('the order is readable', before.status === 200,
      { status: before.status, error: before.body.error });
    check('it is marked as a business purchase',
      before.body.data?.buyer_is_business === true,
      { got: before.body.data?.buyer_is_business });
    check('...with no fee on it yet', Number(before.body.data?.delivery_fee) === 0,
      { got: before.body.data?.delivery_fee });
    check('...so the total is still just the goods',
      Number(before.body.data?.total) === Number(SUBTOTAL),
      { got: before.body.data?.total, want: SUBTOTAL });

    // ─── 2. The office prices it ─────────────────────────────
    const priced = await call(`/api/admin/orders/${order.id}/delivery-fee`, {
      method: 'PUT', token, body: { delivery_fee: FEE },
    });
    check('an admin can put a fee on a wholesale order', priced.status === 200,
      { status: priced.status, error: priced.body.error });
    check('...and it is the fee they set', Number(priced.body.data?.delivery_fee) === FEE,
      { got: priced.body.data?.delivery_fee, want: FEE });

    // ─── 3. THE TOTAL FOLLOWS — the promise made to the customer
    const want = Number(SUBTOTAL) + FEE;
    check('THE TOTAL IS RECOMPUTED, which is what the customer was promised',
      Number(priced.body.data?.total) === want,
      { got: priced.body.data?.total, want });

    const after = await call(`/api/admin/orders/${order.id}`, { token });
    check('...and it is stored, not just returned',
      Number(after.body.data?.total) === want && Number(after.body.data?.delivery_fee) === FEE,
      { total: after.body.data?.total, fee: after.body.data?.delivery_fee });

    check('...while the goods are untouched',
      Number(after.body.data?.subtotal) === Number(SUBTOTAL),
      { got: after.body.data?.subtotal });

    // ─── 4. And it can be corrected ──────────────────────────
    //
    // A drop re-priced after the van is loaded is an ordinary thing; the fee
    // is deliberately editable for as long as the order is.
    const again = await call(`/api/admin/orders/${order.id}/delivery-fee`, {
      method: 'PUT', token, body: { delivery_fee: 25 },
    });
    check('the fee can be corrected afterwards', again.status === 200
      && Number(again.body.data?.total) === Number(SUBTOTAL) + 25,
      { status: again.status, total: again.body.data?.total });

    // ─── 5. A SPLIT purchase is priced ONCE, on the whole thing ──
    //
    // Cesto takes the whole package out, so there is one delivery and one
    // fee. It belongs to the ParentOrder and every part carries zero — and
    // until this route existed the parent could not be priced at all: the id
    // matched no Order and the admin got "Order not found", so a split
    // wholesale purchase was unpriceable by anyone.
    const parent = await prisma.parentOrder.create({
      data: {
        order_number: generateParentOrderNumber(),
        user_id: user.id, address_id: address.id, payment_method: 'cod',
        address_snapshot: {},
        subtotal: new Prisma.Decimal('300.00'),
        delivery_fee_total: new Prisma.Decimal(0),
        total: new Prisma.Decimal('300.00'),
      },
      select: { id: true },
    });
    parentIds.push(parent.id);

    const partIds: string[] = [];
    for (let i = 0; i < 2; i++) {
      const part = await prisma.order.create({
        data: {
          order_number: generateOrderNumber(),
          user_id: user.id, address_id: address.id, status: 'pending',
          payment_method: 'cod', parent_order_id: parent.id,
          address_snapshot: {},
          buyer_is_business: true,
          subtotal: new Prisma.Decimal('150.00'),
          delivery_fee: new Prisma.Decimal(0),
          total: new Prisma.Decimal('150.00'),
        },
        select: { id: true },
      });
      partIds.push(part.id);
      orderIds.push(part.id);
    }

    const onPart = await call(`/api/admin/orders/${partIds[0]}/delivery-fee`, {
      method: 'PUT', token, body: { delivery_fee: 9 },
    });
    check('a fee on ONE PART of a purchase is refused', onPart.status === 422,
      { status: onPart.status, error: onPart.body.error });
    check('...and says why — the fee belongs to the whole purchase',
      /whole purchase/i.test(onPart.body.error ?? ''), { error: onPart.body.error });

    const onPurchase = await call(`/api/admin/orders/${parent.id}/delivery-fee`, {
      method: 'PUT', token, body: { delivery_fee: 30 },
    });
    check('a fee on the WHOLE PURCHASE is accepted', onPurchase.status === 200,
      { status: onPurchase.status, error: onPurchase.body.error });
    check('...landing on the purchase, with its total recomputed',
      Number(onPurchase.body.data?.delivery_fee_total) === 30
      && Number(onPurchase.body.data?.total) === 330,
      { fee: onPurchase.body.data?.delivery_fee_total, total: onPurchase.body.data?.total });

    const partsAfter = await prisma.order.findMany({
      where: { id: { in: partIds } },
      select: { delivery_fee: true, total: true },
    });
    check('...while every part still carries zero, charged once',
      partsAfter.every((o) => Number(o.delivery_fee) === 0 && Number(o.total) === 150),
      partsAfter.map((o) => ({ fee: Number(o.delivery_fee), total: Number(o.total) })));

    // ─── 6. A retail customer's own order: no fee until we set it ──
    //
    // Their quote and their checkout carry zero, marked as to come; setting
    // it recomputes the total and tells them, with the figure and the total.
    const variant = await prisma.productVariant.findFirst({
      where: { is_active: true, stock_quantity: { gte: 5 }, price: { gt: 0 }, product: { is_active: true, store_id: null } },
      select: { id: true, product_id: true, price: true },
    });
    if (!variant) {
      console.log('  SKIP  section 6 — no active house product with stock');
    } else {
      const shopper = await prisma.user.create({
        data: { name: `QA Retail ${stamp}`, email: `qa.retail.fee.${stamp}@cesto.test` },
        select: { id: true, email: true },
      });
      userIds.push(shopper.id);
      const home = await prisma.address.create({
        data: {
          user_id: shopper.id, contact_name: 'QA', contact_phone: '600000001',
          street_line_1: 'C/ Prueba 2', postcode: '28013', city: 'Madrid', province: 'Madrid', is_default: true,
        },
        select: { id: true },
      });
      const ct = generateAccessToken({ userId: shopper.id, email: shopper.email ?? undefined });
      const added = await call('/api/cart/items', {
        method: 'POST', token: ct, body: { productId: variant.product_id, variantId: variant.id, quantity: 2 },
      });
      check('retail: the product goes in the cart', added.status < 300, { status: added.status, error: added.body.error });
      const goods = Number(variant.price) * 2;

      const quote = await call('/api/orders/quote', { method: 'POST', token: ct, body: { addressId: home.id } });
      check('retail: the quote carries no delivery fee, marked as to come',
        quote.status === 200 && Number(quote.body.data?.deliveryFee) === 0 && quote.body.data?.deliveryFeePending === true
        && quote.body.data?.delivery?.reason === 'set_later',
        { status: quote.status, fee: quote.body.data?.deliveryFee, pending: quote.body.data?.deliveryFeePending, reason: quote.body.data?.delivery?.reason });
      check('retail: ...so the quoted total is the goods', Number(quote.body.data?.total) === goods,
        { total: quote.body.data?.total, goods });

      const placed = await call('/api/orders', { method: 'POST', token: ct, body: { addressId: home.id, paymentMethod: 'cod' } });
      const retailOrder = placed.body.data;
      if (retailOrder?.id) orderIds.push(retailOrder.id);
      check('retail: the order is placed with no fee and the goods as its total',
        placed.status === 201 && Number(retailOrder?.delivery_fee) === 0 && Number(retailOrder?.total) === goods,
        { status: placed.status, fee: retailOrder?.delivery_fee, total: retailOrder?.total, error: placed.body.error });

      if (retailOrder?.id) {
        const notices = () => prisma.notification.findMany({
          where: { user_id: shopper.id, type: 'order_edited' }, select: { title_es: true, body_es: true },
        });
        const set = await call(`/api/admin/orders/${retailOrder.id}/delivery-fee`, { method: 'PUT', token, body: { delivery_fee: 4.5 } });
        check('retail: the office sets the fee and the total follows',
          set.status === 200 && Number(set.body.data?.total) === goods + 4.5, { status: set.status, total: set.body.data?.total });
        await new Promise((r) => setTimeout(r, 400));
        const n1 = await notices();
        check('retail: the customer is told — "Hemos añadido el envío", with the fee and the total',
          n1.length === 1 && /añadido el envío/.test(n1[0].title_es) && /4,50 €/.test(n1[0].body_es),
          n1);

        await call(`/api/admin/orders/${retailOrder.id}/delivery-fee`, { method: 'PUT', token, body: { delivery_fee: 4.5 } });
        await new Promise((r) => setTimeout(r, 400));
        check('retail: saving the same fee again says nothing', (await notices()).length === 1);

        await call(`/api/admin/orders/${retailOrder.id}/delivery-fee`, { method: 'PUT', token, body: { delivery_fee: 6 } });
        await new Promise((r) => setTimeout(r, 400));
        const n3 = await notices();
        check('retail: changing it says it changed', n3.length === 2 && n3.some((n) => /cambiado el envío/.test(n.title_es)), n3);

        // Stock back: the checkout took two.
        await prisma.productVariant.update({ where: { id: variant.id }, data: { stock_quantity: { increment: 2 } } });
      }
    }

  } finally {
    if (userIds.length) await prisma.notification.deleteMany({ where: { user_id: { in: userIds } } });
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
