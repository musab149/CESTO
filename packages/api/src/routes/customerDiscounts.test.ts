// ─── Integration test · a price agreed with one customer ──────────────────
//
// Run:  cd packages/api && npm run test:customer-discounts
//
// 2026-10-25, the user's words: a discount staff or a rep give a customer on
// a product is per UNIT — "a product with price 4 and a discount of 2, that
// product's price for that customer becomes 2" — and it is SAVED for that
// customer, so they see it in the shop, pay it at checkout, and the next order
// built for them starts with it. The product's own price never changes. The
// LATEST order that says anything about it wins; clearing it removes it.
//
// What has to hold, none of it visible from one screen:
//   · an order line stores euros off one unit, and the line's flat discount
//     (what totals and invoices read) is that times the quantity — on the way
//     in and after every quantity change;
//   · staff and reps saying a discount saves it, saying zero forgets it;
//   · the customer's catalogue, quote and checkout all use it, and nobody
//     else's do;
//   · an order or an `add` that states nothing gets the saved discount;
//   · a client from before per-unit discounts still gets its flat figure;
//   · a customer cannot state a discount for themselves.
//
// Goes through the real HTTP routes. Makes its own rep, client and orders,
// and puts back every unit of stock it took.
import http from 'http';
import { Prisma } from '@prisma/client';
import app from '../server';
import prisma from '../lib/prisma';
import { generateAccessToken, generateAdminAccessToken } from '../lib/jwt';

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
  const note = (variantId: string, units: number) => taken.set(variantId, (taken.get(variantId) ?? 0) + units);
  /** A's B2B price before section 7 gave it one. */
  let b2bBefore: { id: string; b2b_price: Prisma.Decimal | null } | null = null;

  const call = async (path: string, init: { method?: string; body?: unknown; token?: string } = {}) => {
    const res = await fetch(`${base}${path}`, {
      method: init.method ?? 'GET',
      headers: { 'Content-Type': 'application/json', ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    return {
      status: res.status,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      body: await res.json() as { success: boolean; error?: string; data?: any },
    };
  };

  try {
    // ─── Fixtures ────────────────────────────────────────────
    // Cesto's own products, so the storefront shows them to anyone.
    const variants = await prisma.productVariant.findMany({
      where: {
        is_active: true,
        product: { is_active: true, store_id: null },
        stock_quantity: { gte: 40 },
        price: { gt: 5 },
      },
      select: { id: true, price: true, product_id: true },
      take: 2,
    });
    if (variants.length < 2) {
      console.log(`  SKIP  only ${variants.length} priced variants with stock to work with`);
      return;
    }
    const [v1, v2] = variants;
    const p1 = Number(v1.price);
    const p2 = Number(v2.price);
    const OFF = 2;
    console.log(`  ..    A costs ${p1.toFixed(2)}, B costs ${p2.toFixed(2)}; ${OFF.toFixed(2)} off each A\n`);

    const admin = await prisma.admin.findFirst({ select: { id: true, email: true, role: true } });
    if (!admin) { console.log('  SKIP  no admin row to act as'); return; }
    const adminToken = generateAdminAccessToken({ adminId: admin.id, email: admin.email, role: admin.role });

    const rep = await prisma.user.create({ data: { name: `QA CDisc ${stamp}`, email: `qa.cdisc.${stamp}@cesto.test` } });
    userIds.push(rep.id);
    await prisma.salesRep.create({ data: { user_id: rep.id, is_active: true, house_store: true } }); // its products are Cesto's own (lib/repStore)
    const repToken = generateAccessToken({ userId: rep.id, email: rep.email ?? undefined });

    const client = await prisma.user.create({
      data: { name: `QA CDiscClient ${stamp}`, email: `qa.cdiscclient.${stamp}@cesto.test`, created_by_sales_rep_id: rep.id },
    });
    userIds.push(client.id);
    const clientToken = generateAccessToken({ userId: client.id, email: client.email ?? undefined });
    const other = await prisma.user.create({ data: { name: `QA CDiscOther ${stamp}`, email: `qa.cdiscother.${stamp}@cesto.test` } });
    userIds.push(other.id);
    const otherToken = generateAccessToken({ userId: other.id, email: other.email ?? undefined });

    const address = await prisma.address.create({
      data: {
        user_id: client.id, contact_name: 'QA', contact_phone: '600000003',
        street_line_1: 'C/ Precio 2', postcode: '28016', city: 'Madrid', province: 'Madrid',
      },
      select: { id: true },
    });

    const lineOf = (orderId: string, variantId: string) => prisma.orderItem.findFirst({
      where: { order_id: orderId, variant_id: variantId },
      select: { id: true, quantity: true, unit_price: true, discount_amount: true, unit_discount: true, line_total: true },
    });
    const savedOf = (variantId: string) => prisma.customerProductDiscount.findUnique({
      where: { user_id_variant_id: { user_id: client.id, variant_id: variantId } },
    });
    const place = async (token: string, path: string, items: unknown[]) => {
      const r = await call(path, { method: 'POST', token, body: { user_id: client.id, address_id: address.id, delivery_fee: 0, items } });
      const id = r.body.data?.order?.id as string | undefined;
      if (id) orderIds.push(id);
      return { r, id };
    };

    // ─── 1. A REP gives it per unit, and it is saved ─────────
    // The shape the new screens send: the per-unit figure, plus the flat one
    // an older API would read during a deploy.
    const first = await place(repToken, '/api/sales/orders', [
      { variant_id: v1.id, quantity: 3, unit_discount: OFF, discount_amount: OFF * 3 },
      { variant_id: v2.id, quantity: 1, unit_discount: 0 },
    ]);
    check('a rep places an order with a per-unit discount', first.r.status === 201, { status: first.r.status, error: first.r.body.error });
    if (!first.id) { console.log('  ABORT'); return; }
    note(v1.id, 3); note(v2.id, 1);
    const l1 = await lineOf(first.id, v1.id);
    check('the line stores euros off ONE unit', cents(l1?.unit_discount) === cents(OFF), l1);
    check('...and its flat discount is that times the quantity (2 × 3 = 6)', cents(l1?.discount_amount) === cents(OFF * 3), l1);
    check('...so it costs (price − 2) each', cents(l1?.line_total) === cents((p1 - OFF) * 3), { got: l1?.line_total, want: ((p1 - OFF) * 3).toFixed(2) });
    check('...while the product price on the line is unchanged', cents(l1?.unit_price) === cents(p1), l1);
    const s1 = await savedOf(v1.id);
    check('the discount is SAVED for this customer and product size', cents(s1?.amount) === cents(OFF), s1);
    check('...naming the order and the rep who set it', s1?.order_id === first.id && s1?.set_by_sales_rep_id === rep.id, s1);
    check('a line given zero saves nothing', (await savedOf(v2.id)) === null);

    // ─── 2. The customer sees their price; nobody else does ──
    const priceIn = async (token?: string) => {
      const r = await call(`/api/products/by-ids?ids=${v1.product_id}`, { token });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (r.body.data?.[0]?.variants as any[] | undefined)?.find((v) => v.id === v1.id);
    };
    const mine = await priceIn(clientToken);
    check('in the shop the customer sees price − 2', cents(mine?.price) === cents(p1 - OFF), mine && { price: mine.price, was: mine.compare_at_price });
    check('...with their normal price struck through', cents(mine?.compare_at_price) === cents(p1), mine?.compare_at_price);
    check('...and the discount named', cents(mine?.customer_discount) === cents(OFF), mine?.customer_discount);
    const anon = await priceIn();
    check('a visitor sees the normal price', cents(anon?.price) === cents(p1) && anon?.customer_discount === undefined, anon && { price: anon.price });
    const theirs = await priceIn(otherToken);
    check('another customer sees the normal price', cents(theirs?.price) === cents(p1) && theirs?.customer_discount === undefined, theirs && { price: theirs.price });

    // ─── 3. Quote and checkout charge it ─────────────────────
    await call('/api/cart', { method: 'DELETE', token: clientToken });
    const added = await call('/api/cart/items', { method: 'POST', token: clientToken, body: { productId: v1.product_id, variantId: v1.id, quantity: 2 } });
    check('the customer puts two in their cart', added.status === 200 || added.status === 201, { status: added.status, error: added.body.error });
    const quote = await call('/api/orders/quote', { method: 'POST', token: clientToken, body: { addressId: address.id } });
    check('the quote charges their price', cents(quote.body.data?.subtotal) === cents((p1 - OFF) * 2), { got: quote.body.data?.subtotal, want: ((p1 - OFF) * 2).toFixed(2) });
    const checkout = await call('/api/orders', { method: 'POST', token: clientToken, body: { addressId: address.id, paymentMethod: 'cod' } });
    const ownId = (checkout.body.data?.id ?? checkout.body.data?.order?.id ?? checkout.body.data?.orders?.[0]?.id) as string | undefined;
    check('the customer checks out', checkout.status === 201 && !!ownId, { status: checkout.status, error: checkout.body.error });
    if (ownId) {
      orderIds.push(ownId); note(v1.id, 2);
      const own = await lineOf(ownId, v1.id);
      check('...and their order line carries the discount per unit, product price untouched',
        cents(own?.unit_discount) === cents(OFF) && cents(own?.unit_price) === cents(p1) && cents(own?.line_total) === cents((p1 - OFF) * 2), own);
      check('...which a customer order does not re-save', (await savedOf(v1.id))?.order_id === first.id);
    }

    // ─── 4. The next order starts with it ────────────────────
    // A client that states nothing about a line (as an older screen would)
    // gets the saved discount.
    const next = await place(adminToken, '/api/admin/orders', [{ variant_id: v1.id, quantity: 1 }]);
    check('admin places an order stating no discount', next.r.status === 201, { status: next.r.status, error: next.r.body.error });
    if (!next.id) { console.log('  ABORT'); return; }
    note(v1.id, 1);
    const ln = await lineOf(next.id, v1.id);
    check('...and the saved discount is already on the line', cents(ln?.unit_discount) === cents(OFF) && cents(ln?.line_total) === cents(p1 - OFF), ln);

    // ─── 5. Quantity changes carry it per unit ───────────────
    const bump = await call(`/api/admin/orders/${next.id}/items`, {
      method: 'PUT', token: adminToken,
      body: { operations: [{ action: 'update_qty', order_item_id: ln!.id, new_quantity: 4 }] },
    });
    check('admin changes the quantity to 4', bump.status === 200, { status: bump.status, error: bump.body.error });
    note(v1.id, 3);
    const lb = await lineOf(next.id, v1.id);
    check('...and the discount follows it: 2 × 4 = 8 off', cents(lb?.discount_amount) === cents(OFF * 4) && cents(lb?.line_total) === cents((p1 - OFF) * 4), lb);

    // ─── 6. The latest order wins ────────────────────────────
    const changed = await call(`/api/admin/orders/${next.id}/items`, {
      method: 'PUT', token: adminToken,
      body: { operations: [{ action: 'set_discount', order_item_id: ln!.id, unit_discount: 1.5, discount_amount: 6 }] },
    });
    check('admin sets 1.50 off each instead', changed.status === 200, { status: changed.status, error: changed.body.error });
    const lc = await lineOf(next.id, v1.id);
    check('...the line is 1.50 × 4 = 6 off', cents(lc?.unit_discount) === 150 && cents(lc?.discount_amount) === 600 && cents(lc?.line_total) === cents(p1 * 4 - 6), lc);
    const s2 = await savedOf(v1.id);
    check('...and the saved discount is now 1.50, set by admin on this order', cents(s2?.amount) === 150 && s2?.set_by_admin_id === admin.id && s2?.order_id === next.id, s2);

    // An add in an edit stating a figure saves it too.
    const addB = await call(`/api/sales/orders/${first.id}/items`, {
      method: 'PUT', token: repToken,
      body: { operations: [{ action: 'add', new_variant_id: v2.id, new_quantity: 2, unit_discount: 1 }] },
    });
    check('a rep adds B to an order with 1.00 off each', addB.status === 200, { status: addB.status, error: addB.body.error });
    note(v2.id, 2);
    const s3 = await savedOf(v2.id);
    check('...and B is saved at 1.00 for this customer', cents(s3?.amount) === 100, s3);

    // ─── 7. Clearing it forgets it ───────────────────────────
    const clear = await place(adminToken, '/api/admin/orders', [{ variant_id: v1.id, quantity: 1, unit_discount: 0 }]);
    check('admin places an order with A at zero discount', clear.r.status === 201, { status: clear.r.status, error: clear.r.body.error });
    if (clear.id) {
      note(v1.id, 1);
      const lz = await lineOf(clear.id, v1.id);
      check('...the line is at full price', lz?.discount_amount === null && lz?.unit_discount === null && cents(lz?.line_total) === cents(p1), lz);
    }
    check('...and the saved discount for A is gone', (await savedOf(v1.id)) === null);
    const back = await priceIn(clientToken);
    check('...so the shop shows the customer the normal price again', cents(back?.price) === cents(p1) && back?.customer_discount === undefined, back && { price: back.price });

    // ─── 8. A client from before per-unit discounts ──────────
    const legacy = await place(adminToken, '/api/admin/orders', [{ variant_id: v1.id, quantity: 3, discount_amount: 2 }]);
    check('an older screen places a flat €2 off a line of 3', legacy.r.status === 201, { status: legacy.r.status, error: legacy.r.body.error });
    if (legacy.id) {
      note(v1.id, 3);
      const ll = await lineOf(legacy.id, v1.id);
      check('...applied as before, flat, with no per-unit figure', cents(ll?.discount_amount) === 200 && ll?.unit_discount === null && cents(ll?.line_total) === cents(p1 * 3 - 2), ll);
      check('...and nothing saved, because nothing was said per unit', (await savedOf(v1.id)) === null);
      const conv = await call(`/api/admin/orders/${legacy.id}/items`, {
        method: 'PUT', token: adminToken,
        body: { operations: [{ action: 'update_qty', order_item_id: ll!.id, new_quantity: 6 }] },
      });
      note(v1.id, 3);
      const lv = await lineOf(legacy.id, v1.id);
      check('changing its quantity reads the flat €2 over 3 as 0.67 each (×6 = 4.02)',
        conv.status === 200 && cents(lv?.unit_discount) === 67 && cents(lv?.discount_amount) === 402, lv);
    }

    // ─── 9. The customer's own edit gets their price ─────────
    if (ownId) {
      const ownAdd = await call(`/api/orders/${ownId}/items`, {
        method: 'PUT', token: clientToken,
        body: { operations: [{ action: 'add', new_variant_id: v2.id, new_quantity: 1 }] },
      });
      check('the customer adds B to their own order', ownAdd.status === 200, { status: ownAdd.status, error: ownAdd.body.error });
      note(v2.id, 1);
      const lo = await lineOf(ownId, v2.id);
      check('...at their saved price for B (1.00 off)', cents(lo?.unit_discount) === 100 && cents(lo?.line_total) === cents(p2 - 1), lo);
      const sneaky = await call(`/api/orders/${ownId}/items`, {
        method: 'PUT', token: clientToken,
        body: { operations: [{ action: 'set_discount', order_item_id: lo!.id, unit_discount: 5 }] },
      });
      check('a customer cannot give themselves a discount', sneaky.status === 422, { status: sneaky.status });
      const sneakyAdd = await call(`/api/orders/${ownId}/items`, {
        method: 'PUT', token: clientToken,
        body: { operations: [{ action: 'add', new_variant_id: v1.id, new_quantity: 1, unit_discount: 5 }] },
      });
      if (sneakyAdd.status === 200) note(v1.id, 1);
      const ls = await lineOf(ownId, v1.id);
      check('...not even by stating one on an add', !ls || ls.unit_discount === null || cents(ls.unit_discount) === cents(OFF), ls);
      check('...and saves nothing that way', (await savedOf(v1.id)) === null);
    }

    // ─── 10. The lists, and removing one ─────────────────────
    const adminList = await call(`/api/admin/users/${client.id}/product-discounts`, { token: adminToken });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rowB = (adminList.body.data as any[] | undefined)?.find((r) => r.variant_id === v2.id);
    check('admin lists the customer\'s saved discounts', adminList.status === 200 && (adminList.body.data?.length ?? 0) === 1, { status: adminList.status, n: adminList.body.data?.length });
    check('...with the normal price, the discount and their price', rowB && cents(rowB.price) === cents(p2) && cents(rowB.amount) === 100 && cents(rowB.customer_price) === cents(p2 - 1), rowB);
    check('...and the order it was set on', rowB?.order?.id === first.id, rowB?.order);
    const repList = await call(`/api/sales/clients/${client.id}/product-discounts`, { token: repToken });
    check('the rep reads the same list for their client', repList.status === 200 && repList.body.data?.length === 1, { status: repList.status });
    const removed = await call(`/api/admin/users/${client.id}/product-discounts/${v2.id}`, { method: 'DELETE', token: adminToken });
    check('admin removes it', removed.status === 200 && (await savedOf(v2.id)) === null, { status: removed.status });
    const again = await call(`/api/admin/users/${client.id}/product-discounts/${v2.id}`, { method: 'DELETE', token: adminToken });
    check('...and removing it twice is a 404, not a 500', again.status === 404, { status: again.status });

    // ─── 6b. A customer cannot give themselves one when ORDERING either ──
    // B has no saved discount now. Whatever they send, they pay its price.
    await call('/api/cart', { method: 'DELETE', token: clientToken });
    const cartSneaky = await call('/api/cart/items', {
      method: 'POST', token: clientToken,
      body: { productId: v2.product_id, variantId: v2.id, quantity: 1, unit_discount: 5, discount_amount: 5, discount: 5, price: 0.01 },
    });
    check('a customer\'s cart add carrying a discount is taken as a plain add', cartSneaky.status === 200 || cartSneaky.status === 201, { status: cartSneaky.status, error: cartSneaky.body.error });
    const quoteSneaky = await call('/api/orders/quote', { method: 'POST', token: clientToken, body: { addressId: address.id, items: [{ variant_id: v2.id, quantity: 1, unit_discount: 5 }] } });
    check('...the quote charges B\'s full price', cents(quoteSneaky.body.data?.subtotal) === cents(p2), { got: quoteSneaky.body.data?.subtotal, want: p2 });
    const checkoutSneaky = await call('/api/orders', {
      method: 'POST', token: clientToken,
      body: { addressId: address.id, paymentMethod: 'cod', items: [{ variant_id: v2.id, quantity: 1, unit_discount: 5, discount_amount: 5 }], discount_amount: 5, unit_discount: 5 },
    });
    const sneakyId = (checkoutSneaky.body.data?.id ?? checkoutSneaky.body.data?.order?.id ?? checkoutSneaky.body.data?.orders?.[0]?.id) as string | undefined;
    if (sneakyId) { orderIds.push(sneakyId); note(v2.id, 1); }
    const sneakyLine = sneakyId ? await lineOf(sneakyId, v2.id) : null;
    check('...and checking out with discounts in the request charges it in full',
      checkoutSneaky.status === 201 && sneakyLine?.unit_discount === null && sneakyLine?.discount_amount === null && cents(sneakyLine?.line_total) === cents(p2),
      { status: checkoutSneaky.status, error: checkoutSneaky.body.error, line: sneakyLine });
    check('...saving nothing for them', (await savedOf(v2.id)) === null);
    if (sneakyId) {
      const sneakyEdit = await call(`/api/orders/${sneakyId}/items`, { method: 'PUT', token: clientToken, body: { operations: [{ action: 'update_qty', order_item_id: sneakyLine!.id, new_quantity: 2, unit_discount: 5, discount_amount: 10 }] } });
      const afterEdit = await lineOf(sneakyId, v2.id);
      check('a discount riding on their own quantity change is ignored too',
        sneakyEdit.status === 200 && afterEdit?.quantity === 2 && afterEdit?.unit_discount === null && cents(afterEdit?.line_total) === cents(p2 * 2),
        { status: sneakyEdit.status, line: afterEdit });
    }

    // ─── 7. A business: it comes off their B2B price ─────────
    // A wholesale price below the shop's on A, put back afterwards.
    const B2B = Math.round((p1 - 1.5) * 100) / 100;
    const BOFF = 0.5;
    b2bBefore = { id: v1.id, b2b_price: (await prisma.productVariant.findUnique({ where: { id: v1.id }, select: { b2b_price: true } }))?.b2b_price ?? null };
    await prisma.productVariant.update({ where: { id: v1.id }, data: { b2b_price: B2B } });
    console.log(`\n  ..    a business: A at ${B2B.toFixed(2)} wholesale (shop ${p1.toFixed(2)}); ${BOFF.toFixed(2)} off each\n`);
    const biz = await prisma.user.create({
      data: { name: `QA CDiscBiz ${stamp}`, email: `qa.cdiscbiz.${stamp}@cesto.test`, is_business: true, pricing_mode: 'b2b', created_by_sales_rep_id: rep.id },
    });
    userIds.push(biz.id);
    const bizToken = generateAccessToken({ userId: biz.id, email: biz.email ?? undefined });
    const bizAddress = await prisma.address.create({
      data: { user_id: biz.id, contact_name: 'QA Empresa', contact_phone: '600000004', street_line_1: 'C/ Mayorista 4', postcode: '28016', city: 'Madrid', province: 'Madrid' },
      select: { id: true },
    });
    const bizSaved = (variantId: string) => prisma.customerProductDiscount.findUnique({ where: { user_id_variant_id: { user_id: biz.id, variant_id: variantId } } });
    const bizPlace = async (token: string, path: string, items: unknown[]) => {
      const r = await call(path, { method: 'POST', token, body: { user_id: biz.id, address_id: bizAddress.id, delivery_fee: 0, items } });
      const id = r.body.data?.order?.id as string | undefined;
      if (id) orderIds.push(id);
      return { r, id };
    };

    const bRep = await bizPlace(repToken, '/api/sales/orders', [{ variant_id: v1.id, quantity: 2, unit_discount: BOFF, discount_amount: BOFF * 2 }]);
    check('a rep gives a business client 0.50 off each', bRep.r.status === 201, { status: bRep.r.status, error: bRep.r.body.error });
    const bl1 = bRep.id ? await lineOf(bRep.id, v1.id) : null;
    check('...off their B2B price: the line is at the B2B unit price, (B2B − 0.50) × 2',
      cents(bl1?.unit_price) === cents(B2B) && cents(bl1?.unit_discount) === 50 && cents(bl1?.line_total) === cents((B2B - BOFF) * 2), bl1);
    check('...and saved for the business', cents((await bizSaved(v1.id))?.amount) === 50);

    const bizSees = await priceIn(bizToken);
    check('in the shop the business sees B2B − 0.50, the B2B price struck through',
      cents(bizSees?.price) === cents(B2B - BOFF) && cents(bizSees?.compare_at_price) === cents(B2B) && cents(bizSees?.customer_discount) === 50,
      bizSees && { price: bizSees.price, was: bizSees.compare_at_price, off: bizSees.customer_discount });
    const retailSees = await priceIn(clientToken);
    check('the retail client still sees the shop price, and no B2B price at all',
      cents(retailSees?.price) === cents(p1) && retailSees?.b2b_price === undefined && retailSees?.customer_discount === undefined,
      retailSees && { price: retailSees.price, b2b: retailSees.b2b_price });

    await call('/api/cart', { method: 'DELETE', token: bizToken });
    const bAdd = await call('/api/cart/items', { method: 'POST', token: bizToken, body: { productId: v1.product_id, variantId: v1.id, quantity: 2 } });
    check('the business puts two in their cart', bAdd.status === 200 || bAdd.status === 201, { status: bAdd.status, error: bAdd.body.error });
    const bQuote = await call('/api/orders/quote', { method: 'POST', token: bizToken, body: { addressId: bizAddress.id } });
    check('the quote charges (B2B − 0.50) × 2', cents(bQuote.body.data?.subtotal) === cents((B2B - BOFF) * 2), { got: bQuote.body.data?.subtotal, want: ((B2B - BOFF) * 2).toFixed(2) });
    const bCheckout = await call('/api/orders', { method: 'POST', token: bizToken, body: { addressId: bizAddress.id, paymentMethod: 'cod' } });
    const bOwnId = (bCheckout.body.data?.id ?? bCheckout.body.data?.order?.id ?? bCheckout.body.data?.orders?.[0]?.id) as string | undefined;
    check('the business checks out', bCheckout.status === 201 && !!bOwnId, { status: bCheckout.status, error: bCheckout.body.error });
    if (bOwnId) {
      orderIds.push(bOwnId); note(v1.id, 2);
      const own = await lineOf(bOwnId, v1.id);
      check('...charged the B2B price less 0.50 each', cents(own?.unit_price) === cents(B2B) && cents(own?.unit_discount) === 50 && cents(own?.line_total) === cents((B2B - BOFF) * 2), own);
    }

    const bAdmin = await bizPlace(adminToken, '/api/admin/orders', [{ variant_id: v1.id, quantity: 3 }]);
    check('admin builds the business an order stating no discount', bAdmin.r.status === 201, { status: bAdmin.r.status, error: bAdmin.r.body.error });
    const bl2 = bAdmin.id ? await lineOf(bAdmin.id, v1.id) : null;
    check('...and the saved 0.50 comes off the B2B price: (B2B − 0.50) × 3',
      cents(bl2?.unit_price) === cents(B2B) && cents(bl2?.unit_discount) === 50 && cents(bl2?.line_total) === cents((B2B - BOFF) * 3), bl2);

    const bList = await call(`/api/admin/users/${biz.id}/product-discounts`, { token: adminToken });
    const bRow = (bList.body.data ?? []).find((r: { variant_id: string }) => r.variant_id === v1.id);
    check('the agreed-prices list shows the business their B2B price and B2B − 0.50',
      cents(bRow?.price) === cents(B2B) && cents(bRow?.customer_price) === cents(B2B - BOFF), bRow && { price: bRow.price, theirs: bRow.customer_price });
    const bRepList = await call(`/api/sales/clients/${biz.id}/product-discounts`, { token: repToken });
    check('...and the rep sees the same for their business client', cents(bRepList.body.data?.[0]?.customer_price) === cents(B2B - BOFF), bRepList.body.data?.[0]);

    const bBig = await bizPlace(repToken, '/api/sales/orders', [{ variant_id: v1.id, quantity: 1, unit_discount: B2B + 1 }]);
    const bl3 = bBig.id ? await lineOf(bBig.id, v1.id) : null;
    check('a discount bigger than the B2B price makes the line free, never negative', bBig.r.status === 201 && cents(bl3?.line_total) === 0, { status: bBig.r.status, line: bl3 });
    const bizFree = await priceIn(bizToken);
    check('...and the shop shows it at 0, not below', cents(bizFree?.price) === 0, bizFree && { price: bizFree.price });
  } finally {
    if (b2bBefore) await prisma.productVariant.update({ where: { id: b2bBefore.id }, data: { b2b_price: b2bBefore.b2b_price } }).catch(() => {});
    if (orderIds.length) {
      await prisma.customerProductDiscount.deleteMany({ where: { order_id: { in: orderIds } } });
      await prisma.orderEditLog.deleteMany({ where: { order_id: { in: orderIds } } });
      await prisma.orderItem.deleteMany({ where: { order_id: { in: orderIds } } });
      await prisma.orderIdempotency.deleteMany({ where: { order_id: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    // Deleting orders does not restock, so every unit taken goes back by hand.
    for (const [variantId, units] of taken) {
      await prisma.productVariant.update({ where: { id: variantId }, data: { stock_quantity: { increment: units } } });
    }
    if (userIds.length) {
      await prisma.cartItem.deleteMany({ where: { user_id: { in: userIds } } });
      await prisma.customerProductDiscount.deleteMany({ where: { user_id: { in: userIds } } });
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
