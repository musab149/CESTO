// ─── Integration test · customer-side order editing ─────────────
//
// Run:  cd packages/api && npx ts-node src/lib/customerEditOrder.test.ts
//
// editOrder.test.ts already covers the mechanics of an edit — which rows
// move, how totals recompute, the cross-store split. This file covers what
// changed when the CUSTOMER became an allowed editor (2026-09-30):
//
//   1. the status window — editable through `preparing`, closed at
//      `on_the_way` and beyond; a `draft` only if they made it (2026-11-04)
//   2. attribution — a customer edit is logged as OrderEditActor.customer
//      against editor_customer_id, not as an admin or a partner
//   3. scoping — scopeWhere keeps one customer out of another's order, and
//      reports it as not_found rather than leaking that the id exists
//   4. the invoice guard — an ISSUED invoice freezes the order's contents
//      for EVERY caller. This one is a behaviour change for admin too: the
//      /items route had no such check before, only the delivery-fee route
//      did, so an admin could silently desync an issued invoice.
//   5. a refused batch is atomic — a shortfall anywhere leaves both the
//      items and the stock exactly as they were
//
// Creates its own throwaway category/products/order and removes them in a
// finally block. Reads the seeded user + address only for their ids.

import '../server';
import prisma from './prisma';
import { editOrder } from './editOrder';
import { generateOrderNumber } from './pagination';
import { formatInvoiceNumber } from './invoicing';
import { Prisma, OrderStatus } from '@prisma/client';

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}`);
    if (detail !== undefined) console.log(`        ${JSON.stringify(detail, null, 2)}`);
  }
}

const SERIES = 'ZZ';
const YEAR = 2999;

async function main() {
  const categoryId = (await prisma.category.create({
    data: { name_es: 'Test CustEdit Category', name_en: 'Test CustEdit Category' },
  })).id;

  const productIds: string[] = [];
  const invoiceIds: string[] = [];
  const orderIds: string[] = [];

  async function makeProduct(suffix: string, price: string, stock: number) {
    const p = await prisma.product.create({
      data: {
        name_es: `CustEdit ${suffix}`, name_en: `CustEdit ${suffix}`,
        category_id: categoryId,
        store_id: null,
        variants: {
          create: [{
            name_es: 'Default', name_en: 'Default',
            price: new Prisma.Decimal(price), stock_quantity: stock, is_default: true,
          }],
        },
      },
      include: { variants: true },
    });
    productIds.push(p.id);
    return { productId: p.id, variantId: p.variants[0].id };
  }

  const alpha = await makeProduct('alpha', '5.00', 100);
  const beta = await makeProduct('beta', '7.50', 100);
  const scarce = await makeProduct('scarce', '3.00', 2);

  const user = await prisma.user.findFirst({
    where: { addresses: { some: {} } },
    select: { id: true },
  });
  const address = user
    ? await prisma.address.findFirst({ where: { user_id: user.id }, select: { id: true } })
    : null;
  if (!user || !address) throw new Error('No seeded user with an address — cannot run this test.');

  // A second user, to prove scoping. Any other user with a row will do; we
  // never write to them.
  const other = await prisma.user.findFirst({
    where: { id: { not: user.id } },
    select: { id: true },
  });
  if (!other) throw new Error('Need a second user row to test scoping.');

  async function makeOrder(status: OrderStatus, lines: { variantId: string; qty: number; price: string }[]) {
    const subtotal = lines.reduce(
      (s, l) => s.plus(new Prisma.Decimal(l.price).mul(l.qty)),
      new Prisma.Decimal(0),
    );
    const order = await prisma.order.create({
      data: {
        order_number: generateOrderNumber(),
        user_id: user!.id,
        address_id: address!.id,
        address_snapshot: {},
        status,
        store_id: null,
        subtotal,
        delivery_fee: new Prisma.Decimal('2.00'),
        total: subtotal.plus(new Prisma.Decimal('2.00')),
        items: {
          create: lines.map((l) => ({
            product_id: productIds[0],
            variant_id: l.variantId,
            quantity: l.qty,
            unit_price: new Prisma.Decimal(l.price),
            line_total: new Prisma.Decimal(l.price).mul(l.qty),
            product_snapshot: {},
          })),
        },
      },
      include: { items: true },
    });
    orderIds.push(order.id);
    return order;
  }

  try {
    // ─── 1. The status window ─────────────────────────────────
    console.log('\n1. Status window');

    for (const status of ['pending', 'confirmed', 'preparing'] as OrderStatus[]) {
      const o = await makeOrder(status, [{ variantId: alpha.variantId, qty: 2, price: '5.00' }]);
      const r = await editOrder(
        o.id,
        [{ action: 'update_qty', order_item_id: o.items[0].id, new_quantity: 3 }],
        { type: 'customer', customerId: user.id },
        { user_id: user.id },
      );
      check(`${status} is editable`, r.status === 'edited', r);
    }

    // A DRAFT THEY MADE THEMSELVES is theirs to change since 2026-11-04 —
    // what their checkout parked when stock was short — and moves no stock.
    // One our team built for them is still the office's working copy.
    {
      const o = await makeOrder('draft', [{ variantId: alpha.variantId, qty: 1, price: '5.00' }]);
      const stockOf = async () => (await prisma.productVariant.findUniqueOrThrow({
        where: { id: alpha.variantId }, select: { stock_quantity: true },
      })).stock_quantity;
      const before = await stockOf();
      const r = await editOrder(
        o.id,
        [{ action: 'update_qty', order_item_id: o.items[0].id, new_quantity: 2 }],
        { type: 'customer', customerId: user.id },
        { user_id: user.id },
      );
      check('their own draft is editable, and stays a draft',
        r.status === 'edited' && r.order.status === 'draft', r);
      check('...moving no stock', (await stockOf()) === before, { before, after: await stockOf() });

      const staff = await prisma.admin.findFirst({ select: { id: true } });
      if (staff) {
        const built = await makeOrder('draft', [{ variantId: alpha.variantId, qty: 1, price: '5.00' }]);
        await prisma.order.update({ where: { id: built.id }, data: { created_by_admin_id: staff.id } });
        const r2 = await editOrder(
          built.id,
          [{ action: 'update_qty', order_item_id: built.items[0].id, new_quantity: 2 }],
          { type: 'customer', customerId: user.id },
          { user_id: user.id },
        );
        check('a draft our team built for them is refused',
          r2.status === 'not_editable' && r2.currentStatus === 'draft', r2);
      }
    }

    for (const status of ['on_the_way', 'delivered', 'cancelled'] as OrderStatus[]) {
      const o = await makeOrder(status, [{ variantId: alpha.variantId, qty: 1, price: '5.00' }]);
      const r = await editOrder(
        o.id,
        [{ action: 'update_qty', order_item_id: o.items[0].id, new_quantity: 2 }],
        { type: 'customer', customerId: user.id },
        { user_id: user.id },
      );
      check(
        `${status} is refused`,
        r.status === 'not_editable' && r.currentStatus === status,
        r,
      );
    }

    // ─── 2. Attribution ──────────────────────────────────────
    console.log('\n2. Attribution');
    {
      const o = await makeOrder('confirmed', [{ variantId: alpha.variantId, qty: 1, price: '5.00' }]);
      const r = await editOrder(
        o.id,
        [{ action: 'update_qty', order_item_id: o.items[0].id, new_quantity: 4 }],
        { type: 'customer', customerId: user.id },
        { user_id: user.id },
      );
      check('edit applied', r.status === 'edited', r);

      const log = await prisma.orderEditLog.findFirst({
        where: { order_id: o.id },
        orderBy: { created_at: 'desc' },
      });
      check('logged as actor "customer"', log?.editor_type === 'customer', log?.editor_type);
      check('logged against editor_customer_id', log?.editor_customer_id === user.id, log?.editor_customer_id);
      check('no admin attributed', log?.editor_admin_id === null, log?.editor_admin_id);
      check('no partner attributed', log?.editor_partner_user_id === null, log?.editor_partner_user_id);
    }

    // ─── 3. Scoping ──────────────────────────────────────────
    console.log('\n3. Scoping');
    {
      const o = await makeOrder('pending', [{ variantId: alpha.variantId, qty: 1, price: '5.00' }]);
      const r = await editOrder(
        o.id,
        [{ action: 'update_qty', order_item_id: o.items[0].id, new_quantity: 2 }],
        { type: 'customer', customerId: other!.id },
        // The scope the customer route passes — someone else's id.
        { user_id: other!.id },
      );
      check(
        "another customer's order reports not_found, not a 403",
        r.status === 'not_found',
        r,
      );

      const untouched = await prisma.orderItem.findFirst({ where: { order_id: o.id } });
      check('and its items are untouched', untouched?.quantity === 1, untouched?.quantity);
    }

    // ─── 4. The invoice guard ────────────────────────────────
    console.log('\n4. Invoice guard');
    {
      const o = await makeOrder('confirmed', [{ variantId: beta.variantId, qty: 2, price: '7.50' }]);
      const inv = await prisma.invoice.create({
        data: {
          kind: 'albaran', status: 'issued',
          series: SERIES, year: YEAR, number: 9101,
          invoice_number: formatInvoiceNumber(SERIES, 9101),
          issue_date: new Date(),
          order_id: o.id, user_id: user.id,
          seller_snapshot: {}, buyer_snapshot: {}, lines: [], totals: {},
          taxable_base: new Prisma.Decimal('15.00'),
          vat_total: new Prisma.Decimal('1.50'),
          total: new Prisma.Decimal('16.50'),
        },
      });
      invoiceIds.push(inv.id);

      // A ALBARÁN MUST NOT BLOCK. It is a quote, not a fiscal document, and
      // revising a quote is what a quote is for. Until the CIF and the VAT
      // review land, every document is an albarán — so if this ever starts
      // blocking, every order in the system silently freezes.
      const albaranEdit = await editOrder(
        o.id,
        [{ action: 'update_qty', order_item_id: o.items[0].id, new_quantity: 5 }],
        { type: 'customer', customerId: user.id },
        { user_id: user.id },
      );
      check('an issued ALBARÁN does NOT block the edit', albaranEdit.status === 'edited', albaranEdit);

      // Promote it to a factura and the same edit must now be refused.
      await prisma.$executeRawUnsafe('ALTER TABLE invoices DISABLE TRIGGER invoices_no_mutate_issued');
      try {
        await prisma.invoice.update({ where: { id: inv.id }, data: { kind: 'invoice' } });
      } finally {
        await prisma.$executeRawUnsafe('ALTER TABLE invoices ENABLE TRIGGER invoices_no_mutate_issued');
      }

      const asCustomer = await editOrder(
        o.id,
        [{ action: 'update_qty', order_item_id: o.items[0].id, new_quantity: 6 }],
        { type: 'customer', customerId: user.id },
        { user_id: user.id },
      );
      check('an issued FACTURA does block it', asCustomer.status === 'invoiced', asCustomer);

      // The behaviour change: admin is refused too. Before this, the /items
      // route would have applied it and left the issued invoice disagreeing.
      const asAdmin = await editOrder(
        o.id,
        [{ action: 'update_qty', order_item_id: o.items[0].id, new_quantity: 7 }],
        { type: 'admin', adminId: undefined },
      );
      check('ADMIN edit refused once invoiced too', asAdmin.status === 'invoiced', asAdmin);
      if (asAdmin.status === 'invoiced') {
        check(
          'and it names the invoice',
          asAdmin.invoiceNumber === formatInvoiceNumber(SERIES, 9101),
          asAdmin.invoiceNumber,
        );
      }

      // 5 from the albaran edit that was correctly allowed; neither of the
      // two refused factura attempts moved it.
      const stillFive = await prisma.orderItem.findFirst({ where: { order_id: o.id } });
      check('items unchanged by either refused attempt', stillFive?.quantity === 5, stillFive?.quantity);

      // A DRAFT invoice must NOT block — it re-reads its order on load, so
      // it follows the edit rather than contradicting it.
      const o2 = await makeOrder('confirmed', [{ variantId: beta.variantId, qty: 1, price: '7.50' }]);
      const draftInv = await prisma.invoice.create({
        data: {
          kind: 'albaran', status: 'draft',
          series: SERIES, year: YEAR,
          order_id: o2.id, user_id: user.id,
          seller_snapshot: {}, buyer_snapshot: {}, lines: [], totals: {},
          taxable_base: new Prisma.Decimal('7.50'),
          vat_total: new Prisma.Decimal('0.75'),
          total: new Prisma.Decimal('8.25'),
        },
      });
      invoiceIds.push(draftInv.id);
      const withDraft = await editOrder(
        o2.id,
        [{ action: 'update_qty', order_item_id: o2.items[0].id, new_quantity: 3 }],
        { type: 'customer', customerId: user.id },
        { user_id: user.id },
      );
      check('a DRAFT invoice does not block the edit', withDraft.status === 'edited', withDraft);
    }

    // ─── 4b. The order-detail projection tells the screens ───
    console.log('\n4b. What the order endpoints expose');
    {
      const o = await makeOrder('confirmed', [{ variantId: beta.variantId, qty: 1, price: '7.50' }]);
      // Exactly the projection the three GET /:id routes use. The screens
      // gate their edit controls on this; if it stops coming back they
      // silently start offering edits the server will refuse.
      const before = await prisma.order.findFirst({
        where: { id: o.id },
        select: { invoices: { where: { status: 'issued' }, select: { id: true, invoice_number: true, issue_date: true }, take: 1 } },
      });
      check('an un-invoiced order projects no issued invoice', before?.invoices.length === 0, before?.invoices);

      const inv = await prisma.invoice.create({
        data: {
          kind: 'albaran', status: 'issued',
          series: SERIES, year: YEAR, number: 9102,
          invoice_number: formatInvoiceNumber(SERIES, 9102),
          issue_date: new Date(),
          order_id: o.id, user_id: user.id,
          seller_snapshot: {}, buyer_snapshot: {}, lines: [], totals: {},
          taxable_base: new Prisma.Decimal('7.50'),
          vat_total: new Prisma.Decimal('0.75'),
          total: new Prisma.Decimal('8.25'),
        },
      });
      invoiceIds.push(inv.id);

      const after = await prisma.order.findFirst({
        where: { id: o.id },
        select: { invoices: { where: { status: 'issued' }, select: { id: true, invoice_number: true, issue_date: true }, take: 1 } },
      });
      check('an invoiced order projects exactly one', after?.invoices.length === 1, after?.invoices.length);
      check(
        '  ...carrying the number the screens display',
        after?.invoices[0]?.invoice_number === formatInvoiceNumber(SERIES, 9102),
        after?.invoices[0]?.invoice_number,
      );

      // A DRAFT invoice must not appear in this projection — it locks
      // nothing, and surfacing it would freeze the screens for an order that
      // is still perfectly editable.
      const o2 = await makeOrder('confirmed', [{ variantId: alpha.variantId, qty: 1, price: '5.00' }]);
      const d = await prisma.invoice.create({
        data: {
          kind: 'albaran', status: 'draft', series: SERIES, year: YEAR,
          order_id: o2.id, user_id: user.id,
          seller_snapshot: {}, buyer_snapshot: {}, lines: [], totals: {},
          taxable_base: new Prisma.Decimal('5.00'),
          vat_total: new Prisma.Decimal('0.50'),
          total: new Prisma.Decimal('5.50'),
        },
      });
      invoiceIds.push(d.id);
      const withDraft = await prisma.order.findFirst({
        where: { id: o2.id },
        select: { invoices: { where: { status: 'issued' }, select: { id: true }, take: 1 } },
      });
      check('a DRAFT invoice does not appear in the projection', withDraft?.invoices.length === 0, withDraft?.invoices);
    }

    // ─── 5. A refused batch changes nothing ──────────────────
    console.log('\n5. Atomicity on shortfall');
    {
      const o = await makeOrder('pending', [{ variantId: alpha.variantId, qty: 1, price: '5.00' }]);
      const stockBefore = (await prisma.productVariant.findUniqueOrThrow({
        where: { id: alpha.variantId },
      })).stock_quantity;

      // One good op and one that cannot be satisfied — `scarce` has 2.
      const r = await editOrder(
        o.id,
        [
          { action: 'update_qty', order_item_id: o.items[0].id, new_quantity: 9 },
          { action: 'add', new_variant_id: scarce.variantId, new_quantity: 50 },
        ],
        { type: 'customer', customerId: user.id },
        { user_id: user.id },
      );
      check('batch refused for stock', r.status === 'insufficient_stock', r);

      const itemsAfter = await prisma.orderItem.findMany({ where: { order_id: o.id } });
      check('no item was added', itemsAfter.length === 1, itemsAfter.length);
      check('the good op did NOT apply either', itemsAfter[0]?.quantity === 1, itemsAfter[0]?.quantity);

      const stockAfter = (await prisma.productVariant.findUniqueOrThrow({
        where: { id: alpha.variantId },
      })).stock_quantity;
      check('stock untouched', stockAfter === stockBefore, { stockBefore, stockAfter });
    }
  } finally {
    // Issued invoices are protected by triggers that refuse the delete —
    // the clearest proof they work, and the reason cleanup has to disarm
    // them. No application code path can do this, which is the point.
    if (invoiceIds.length > 0) {
      await prisma.$executeRawUnsafe('ALTER TABLE invoices DISABLE TRIGGER invoices_no_mutate_issued');
      await prisma.$executeRawUnsafe('ALTER TABLE invoices DISABLE TRIGGER invoices_no_delete_issued');
      try {
        await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
      } finally {
        await prisma.$executeRawUnsafe('ALTER TABLE invoices ENABLE TRIGGER invoices_no_mutate_issued');
        await prisma.$executeRawUnsafe('ALTER TABLE invoices ENABLE TRIGGER invoices_no_delete_issued');
      }
    }
    await prisma.invoiceSeries.deleteMany({ where: { series: SERIES, year: YEAR } });
    await prisma.orderEditLog.deleteMany({ where: { order_id: { in: orderIds } } });
    await prisma.orderItem.deleteMany({ where: { order_id: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.productVariant.deleteMany({ where: { product_id: { in: productIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    await prisma.category.deleteMany({ where: { id: categoryId } });

    console.log(`\n${passed} passed, ${failed} failed`);
    await prisma.$disconnect();
    process.exit(failed > 0 ? 1 : 0);
  }
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
