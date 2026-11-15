// ─── Integration test · deleting an order, and deleting a whole purchase ───
//
// Run:  cd packages/api && npm run test:delete-order
//
// Goes through the REAL route over HTTP, because the things that broke here
// were route-level: which id the handler resolves, what it does inside one
// transaction, and what it refuses.
//
// What this pins down:
//
//   · A split purchase deletes as ONE thing. Every part goes together or
//     none does — a half-deleted purchase is not a state the data allows.
//   · One shop's part can still go on its own, leaving the rest alone.
//   · Stock comes back for the parts that were holding it, and ONLY those.
//     A delivered part keeps its stock gone; a cancelled one already gave it
//     back and must not give it twice.
//   · ParentOrder.subtotal/total are columns, not derived, so they are
//     recomputed against what survives. The delivery fee is not reduced.
//   · An issued FACTURA on the purchase stops the whole thing.
//
// Creates its own fixtures and removes them in a finally.

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

async function main() {
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

  const productIds: string[] = [];
  const orderIds: string[] = [];
  const parentIds: string[] = [];
  const invoiceIds: string[] = [];
  let userId: string | null = null;
  let addressId: string | null = null;
  let categoryId: string | null = null;

  try {
    const admin = await prisma.admin.findFirst({ select: { id: true, email: true, role: true } });
    if (!admin) { console.log('  SKIP  no admin row to act as'); return; }

    const token = generateAdminAccessToken({ adminId: admin.id, email: admin.email, role: admin.role });

    const post = async (path: string, body: unknown) => {
      const res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      return { status: res.status, body: await res.json() as { success: boolean; error?: string; data?: unknown } };
    };

    // ─── Fixtures ────────────────────────────────────────────
    const cat = await prisma.category.create({
      data: { name_es: `QA ${stamp}`, name_en: `QA ${stamp}` },
    });
    categoryId = cat.id;

    const user = await prisma.user.create({
      data: { name: `QA Del ${stamp}`, email: `qa.del.${stamp}@cesto.test` },
    });
    userId = user.id;
    const address = await prisma.address.create({
      data: {
        user_id: user.id, contact_name: 'QA', contact_phone: '600000000',
        street_line_1: 'C/ Test 1', postcode: '28016', city: 'Madrid', province: 'Madrid',
      },
    });
    addressId = address.id;

    /** A product whose single variant starts at `stock`. */
    const makeVariant = async (label: string, stock: number) => {
      const p = await prisma.product.create({
        data: {
          name_es: `QA ${label} ${stamp}`, name_en: `QA ${label} ${stamp}`,
          category_id: cat.id, is_active: true,
          variants: { create: [{
            name_es: 'Ud', name_en: 'Unit', price: new Prisma.Decimal('2.00'),
            stock_quantity: stock, is_default: true, is_active: true,
          }] },
        },
        include: { variants: true },
      });
      productIds.push(p.id);
      return { productId: p.id, variantId: p.variants[0].id };
    };

    const stockOf = async (variantId: string) =>
      (await prisma.productVariant.findUnique({
        where: { id: variantId }, select: { stock_quantity: true },
      }))!.stock_quantity;

    /** A purchase: one ParentOrder, one sub-order per entry. */
    const makePurchase = async (
      parts: Array<{ variantId: string; productId: string; qty: number; status: 'pending' | 'delivered' | 'cancelled' }>,
      fee: string,
    ) => {
      const subtotal = parts.reduce((s, p) => s + p.qty * 2, 0);
      const parent = await prisma.parentOrder.create({
        data: {
          order_number: generateParentOrderNumber(),
          user_id: user.id, address_id: address.id, address_snapshot: {},
          payment_method: 'cod',
          subtotal: new Prisma.Decimal(subtotal),
          delivery_fee_total: new Prisma.Decimal(fee),
          total: new Prisma.Decimal(subtotal).plus(new Prisma.Decimal(fee)),
        },
      });
      parentIds.push(parent.id);
      for (const part of parts) {
        const o = await prisma.order.create({
          data: {
            order_number: generateOrderNumber(),
            user_id: user.id, address_id: address.id, address_snapshot: {},
            payment_method: 'cod', parent_order_id: parent.id, status: part.status,
            subtotal: new Prisma.Decimal(part.qty * 2),
            delivery_fee: new Prisma.Decimal(0),
            total: new Prisma.Decimal(part.qty * 2),
            items: { create: [{
              product_id: part.productId, variant_id: part.variantId,
              product_snapshot: {}, quantity: part.qty,
              unit_price: new Prisma.Decimal('2.00'),
              line_total: new Prisma.Decimal(part.qty * 2),
            }] },
          },
        });
        orderIds.push(o.id);

        // Model the stock the way the real flow left it, or the expectations
        // below prove nothing: checkout DECREMENTS at order time, and what happens
        // afterwards depends on the stage.
        //
        //   pending    still held by the order    -> stays decremented
        //   delivered  the goods physically left  -> stays decremented
        //   cancelled  PUT /:id/status gave it back -> net zero
        //
        // Creating the rows without this made every variant sit at its full
        // starting figure, so a restock that worked looked like a failure and
        // one that double-counted would have looked like a pass.
        await prisma.productVariant.update({
          where: { id: part.variantId },
          data: { stock_quantity: { decrement: part.qty } },
        });
        if (part.status === 'cancelled') {
          await prisma.productVariant.update({
            where: { id: part.variantId },
            data: { stock_quantity: { increment: part.qty } },
          });
        }
      }
      return parent;
    };

    // ─── 1. A whole purchase goes in one piece ───────────────
    const a = await makeVariant('A', 100);
    const b = await makeVariant('B', 100);
    const c = await makeVariant('C', 100);
    const p1 = await makePurchase([
      { ...a, qty: 5, status: 'pending' },     // holds stock -> comes back
      { ...b, qty: 3, status: 'delivered' },   // goods are gone -> stays gone
      { ...c, qty: 4, status: 'cancelled' },   // already given back -> not twice
    ], '3.50');

    const r1 = await post(`/api/admin/orders/${p1.id}/delete`, { reason: 'QA whole purchase' });
    check('deleting a PURCHASE by its id succeeds', r1.status === 200, { status: r1.status, error: r1.body.error });
    const d1 = r1.body.data as { kind?: string; deleted_count?: number } | undefined;
    check('...and reports it deleted the whole thing', d1?.kind === 'purchase', d1);
    check('...all three parts at once', d1?.deleted_count === 3, d1?.deleted_count);

    const subsAfter = await prisma.order.findMany({
      where: { parent_order_id: p1.id }, select: { deleted_at: true },
    });
    check('...every part is marked deleted, none left behind',
      subsAfter.length === 3 && subsAfter.every((s) => s.deleted_at !== null),
      subsAfter.map((s) => !!s.deleted_at));

    check('stock returns for the part that held it', await stockOf(a.variantId) === 100, await stockOf(a.variantId));
    check('...not for the delivered part, those goods left', await stockOf(b.variantId) === 97, await stockOf(b.variantId));
    check('...and not twice for the cancelled one', await stockOf(c.variantId) === 100, await stockOf(c.variantId));

    const r1again = await post(`/api/admin/orders/${p1.id}/delete`, { reason: 'again' });
    check('deleting it a second time is refused', r1again.status === 400, r1again.status);

    // ─── 2. One shop can go on its own ───────────────────────
    const d = await makeVariant('D', 100);
    const e = await makeVariant('E', 100);
    const p2 = await makePurchase([
      { ...d, qty: 6, status: 'pending' },
      { ...e, qty: 2, status: 'pending' },
    ], '3.50');
    const [subD, subE] = await prisma.order.findMany({
      where: { parent_order_id: p2.id }, orderBy: { created_at: 'asc' }, select: { id: true },
    });

    const r2 = await post(`/api/admin/orders/${subD.id}/delete`, { reason: 'QA one shop' });
    check('deleting ONE shop of a purchase succeeds', r2.status === 200, { status: r2.status, error: r2.body.error });
    check('...and says it deleted one order, not a purchase',
      (r2.body.data as { kind?: string }).kind === 'order');

    const survivor = await prisma.order.findUnique({ where: { id: subE.id }, select: { deleted_at: true } });
    check('...the other shop is untouched', survivor?.deleted_at === null);
    check('...its stock came back', await stockOf(d.variantId) === 100, await stockOf(d.variantId));
    check('...the surviving shop keeps its stock taken', await stockOf(e.variantId) === 98, await stockOf(e.variantId));

    // The totals the list reads are columns, so they have to be rewritten.
    const p2after = await prisma.parentOrder.findUnique({
      where: { id: p2.id }, select: { subtotal: true, total: true, delivery_fee_total: true },
    });
    check('the purchase subtotal now matches what is left',
      p2after!.subtotal.toString() === '4', p2after!.subtotal.toString());
    check('...the delivery fee is NOT reduced, the rest still ships',
      p2after!.delivery_fee_total.toString() === '3.5', p2after!.delivery_fee_total.toString());
    check('...and the total is the two of them',
      p2after!.total.toString() === '7.5', p2after!.total.toString());

    // ─── 3. The detail stops listing a deleted shop ──────────
    const detail = await fetch(`${base}/api/admin/orders/${p2.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((r) => r.json() as Promise<{ data: { sub_orders: unknown[]; deleted_at: string | null; deleted_sub_order_count: number } }>);
    check('the purchase detail lists only the live parts',
      detail.data.sub_orders.length === 1, detail.data.sub_orders.length);
    check('...and says how many were removed', detail.data.deleted_sub_order_count === 1);
    check('...and is not itself deleted while one part survives',
      detail.data.deleted_at === null);

    // ─── 4. An issued FACTURA stops the whole purchase ───────
    const f = await makeVariant('F', 100);
    const p3 = await makePurchase([{ ...f, qty: 7, status: 'pending' }], '3.50');
    const fac = await prisma.invoice.create({
      data: {
        kind: 'invoice', status: 'issued',
        series: 'QAD', year: 2099, number: Number(stamp.slice(-4)),
        invoice_number: `QAD-2099-${stamp}`, issue_date: new Date(),
        order_id: null, parent_order_id: p3.id, user_id: user.id,
        seller_snapshot: {}, buyer_snapshot: {}, lines: [], totals: {},
        taxable_base: new Prisma.Decimal('14'), vat_total: new Prisma.Decimal('0'),
        total: new Prisma.Decimal('14'),
      },
    });
    invoiceIds.push(fac.id);

    const r3 = await post(`/api/admin/orders/${p3.id}/delete`, { reason: 'QA invoiced' });
    check('a purchase with an issued FACTURA is refused', r3.status === 409, r3.status);
    check('...and the refusal names the invoice',
      (r3.body.error ?? '').includes(`QAD-2099-${stamp}`), r3.body.error);
    check('...and nothing was restocked on the way out',
      await stockOf(f.variantId) === 93, await stockOf(f.variantId));

    const subF = await prisma.order.findFirst({ where: { parent_order_id: p3.id }, select: { deleted_at: true } });
    check('...and the part is still there', subF?.deleted_at === null);

    // The sub-order on its own is refused too — the factura covers it.
    const subFid = await prisma.order.findFirst({ where: { parent_order_id: p3.id }, select: { id: true } });
    const r4 = await post(`/api/admin/orders/${subFid!.id}/delete`, { reason: 'QA invoiced sub' });
    check('...and so is deleting just that shop', r4.status === 409, r4.status);

    // ─── 5. A DRAFT holds no stock, start to finish ──────────
    //
    // `draft` means one thing everywhere: nothing was reserved. Three paths
    // depend on it — cancel and delete both skip the restock for a draft, and
    // confirm-stock decrements when it becomes real. The admin create route
    // used to decrement anyway, so a parked basket took its stock and then
    // got it back on a cancel it never held, or paid for it twice on a
    // confirm.
    const g = await makeVariant('G', 100);

    const draftRes = await post('/api/admin/orders', {
      user_id: userId, address_id: addressId, payment_method: 'cod',
      items: [{ variant_id: g.variantId, quantity: 9 }],
      status: 'draft',
    });
    check('a draft order is created', draftRes.status === 201,
      { status: draftRes.status, error: draftRes.body.error });
    const draftOrder = (draftRes.body.data as { order?: { id: string; status: string } })?.order;
    if (draftOrder) orderIds.push(draftOrder.id);
    check('...parked as a draft', draftOrder?.status === 'draft', draftOrder?.status);
    check('...and takes NO stock', await stockOf(g.variantId) === 100, await stockOf(g.variantId));

    // Confirming is what reserves it, exactly once.
    const confirmed = await post(`/api/admin/orders/${draftOrder!.id}/confirm-stock`, {});
    check('confirming the draft succeeds', confirmed.status === 200,
      { status: confirmed.status, error: confirmed.body.error });
    check('...it becomes pending',
      (confirmed.body.data as { status?: string })?.status === 'pending',
      (confirmed.body.data as { status?: string })?.status);
    check('...and takes the stock once, not twice',
      await stockOf(g.variantId) === 91, await stockOf(g.variantId));

    // A draft that is cancelled must not be handed stock it never held.
    const h = await makeVariant('H', 100);
    const d2 = await post('/api/admin/orders', {
      user_id: userId, address_id: addressId, payment_method: 'cod',
      items: [{ variant_id: h.variantId, quantity: 4 }],
      status: 'draft',
    });
    const o2 = (d2.body.data as { order?: { id: string } })?.order;
    if (o2) orderIds.push(o2.id);
    const cancelled = await (async () => {
      const res = await fetch(`${base}/api/admin/orders/${o2!.id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: 'cancelled' }),
      });
      return { status: res.status };
    })();
    check('a draft can be cancelled', cancelled.status === 200, cancelled.status);
    check('...and cancelling gives back nothing, because it held nothing',
      await stockOf(h.variantId) === 100, await stockOf(h.variantId));

    // Same for deleting one.
    const i = await makeVariant('I', 100);
    const d3 = await post('/api/admin/orders', {
      user_id: userId, address_id: addressId, payment_method: 'cod',
      items: [{ variant_id: i.variantId, quantity: 6 }],
      status: 'draft',
    });
    const o3 = (d3.body.data as { order?: { id: string } })?.order;
    if (o3) orderIds.push(o3.id);
    const del = await post(`/api/admin/orders/${o3!.id}/delete`, { reason: 'QA draft delete' });
    check('a draft can be deleted', del.status === 200, del.status);
    check('...and deleting gives back nothing either',
      await stockOf(i.variantId) === 100, await stockOf(i.variantId));

    // ─── 6. One variant on two lines is netted, not counted twice ──
    //
    // The create route writes a line per basket entry, so a rep who adds the
    // same product twice makes two OrderItem rows for one variant. Create
    // nets them and refuses an oversell up front — but a DRAFT takes no
    // stock, so nothing holds that stock while the basket is parked, and the
    // shop can sell it to somebody else in the meantime. Confirming re-checks,
    // and it used to check each line on its own: 5 and 5 both pass against 8,
    // and the order takes 10 from a shelf holding 8.
    const j = await makeVariant('J', 20);
    const dup = await post('/api/admin/orders', {
      user_id: userId, address_id: addressId, payment_method: 'cod',
      items: [
        { variant_id: j.variantId, quantity: 5 },
        { variant_id: j.variantId, quantity: 5 },
      ],
      status: 'draft',
    });
    const dupOrder = (dup.body.data as { order?: { id: string } })?.order;
    if (dupOrder) orderIds.push(dupOrder.id);
    check('a draft can hold the same variant on two lines', dup.status === 201,
      { status: dup.status, error: dup.body.error });
    check('...and still takes nothing', await stockOf(j.variantId) === 20, await stockOf(j.variantId));

    // The shelf empties while the basket sits parked.
    await prisma.productVariant.update({
      where: { id: j.variantId }, data: { stock_quantity: 8 },
    });

    const dupConfirm = await post(`/api/admin/orders/${dupOrder!.id}/confirm-stock`, {});
    check('confirming is REFUSED — 10 wanted against 8',
      dupConfirm.status === 409, { status: dupConfirm.status, error: dupConfirm.body.error });
    // The route renders the shortfalls into the message. 10 is the sum of the
    // two lines; without netting each would have been checked as 5 against 8,
    // both would have passed, and the order would have taken 10 from 8.
    check('...the shortfall reports the NETTED need, not one line',
      (dupConfirm.body.error ?? '').includes('need 10, have 8'), dupConfirm.body.error);
    check('...and nothing was taken on the way out',
      await stockOf(j.variantId) === 8, await stockOf(j.variantId));

    // ─── 5. A missing id is still a 404 ──────────────────────
    const r5 = await post('/api/admin/orders/00000000-0000-4000-8000-000000000000/delete', {});
    check('an id that is neither an order nor a purchase is 404', r5.status === 404, r5.status);
  } finally {
    if (invoiceIds.length) {
      await prisma.$executeRawUnsafe('ALTER TABLE invoices DISABLE TRIGGER invoices_no_mutate_issued');
      await prisma.$executeRawUnsafe('ALTER TABLE invoices DISABLE TRIGGER invoices_no_delete_issued');
      try { await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } }); }
      finally {
        await prisma.$executeRawUnsafe('ALTER TABLE invoices ENABLE TRIGGER invoices_no_mutate_issued');
        await prisma.$executeRawUnsafe('ALTER TABLE invoices ENABLE TRIGGER invoices_no_delete_issued');
      }
    }
    if (orderIds.length) {
      await prisma.orderItem.deleteMany({ where: { order_id: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    if (parentIds.length) await prisma.parentOrder.deleteMany({ where: { id: { in: parentIds } } });
    if (addressId) await prisma.address.deleteMany({ where: { id: addressId } });
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
    if (productIds.length) {
      await prisma.productVariant.deleteMany({ where: { product_id: { in: productIds } } });
      await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    }
    if (categoryId) await prisma.category.deleteMany({ where: { id: categoryId } });
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
