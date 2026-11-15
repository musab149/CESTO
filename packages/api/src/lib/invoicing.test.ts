// ─── Integration test · invoice numbering and immutability ─────
//
// Run:  cd packages/api && npm run test:invoicing
//
// Two properties carry legal weight and both fail silently:
//
//   Gap-free numbering. A factura series may not have holes. This is why the
//   counter is a row and not a Postgres sequence — nextval() is
//   non-transactional and burns a number on every rollback.
//
//   Immutability. An issued invoice cannot change. The application refuses,
//   but the database is what makes it true, so the trigger is what is tested
//   here rather than the route.
//
// Creates its own series rows and invoices; removes them in a finally.

import '../server';
import prisma from './prisma';
import { Prisma } from '@prisma/client';
import {
  allocateInvoiceNumber, formatInvoiceNumber, madridYear, CONTINUOUS_YEAR,
  invoiceBlockers, invoiceKindFor, buildInvoiceLines,
  isInvoicingConfigured, DEFAULT_INVOICING, issuedFacturaFor, purchaseAsOneBasket,
} from './invoicing';

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}`);
    if (detail !== undefined) console.log(`        ${JSON.stringify(detail)}`);
  }
}

const SERIES = `T${String(Date.now()).slice(-6)}`;
const YEAR = 2099;

async function main() {
  const invoiceIds: string[] = [];
  let orderId: string | null = null;
  let userId: string | null = null;

  try {
    // ─── Numbering ───────────────────────────────────────────
    // A yearly counter left from before (FA-2026-000003 on staging) must not
    // carry into the continuous one, nor be touched by it.
    await prisma.invoiceSeries.create({ data: { series: SERIES, year: YEAR, last_number: 3 } });
    const first = await prisma.$transaction((tx) => allocateInvoiceNumber(tx, SERIES));
    check('a fresh series starts at 0 (user, 2026-11-04), whatever a yearly counter of the same series says', first === 0, first);

    const second = await prisma.$transaction((tx) => allocateInvoiceNumber(tx, SERIES));
    check('the next one is 1', second === 1, second);

    // The property a sequence cannot give: a rolled-back allocation must not
    // burn the number.
    try {
      await prisma.$transaction(async (tx) => {
        await allocateInvoiceNumber(tx, SERIES);
        throw new Error('deliberate rollback');
      });
    } catch { /* expected */ }
    const afterRollback = await prisma.$transaction((tx) => allocateInvoiceNumber(tx, SERIES));
    check('a rolled-back allocation does NOT burn the number',
      afterRollback === 2, afterRollback);

    // Concurrency: twenty at once must produce 3..22 with no gaps and no
    // duplicates.
    const concurrent = await Promise.all(
      Array.from({ length: 20 }, () =>
        prisma.$transaction((tx) => allocateInvoiceNumber(tx, SERIES))),
    );
    const sorted = [...concurrent].sort((a, b) => a - b);
    const expected = Array.from({ length: 20 }, (_, i) => i + 3);
    check('20 simultaneous allocations produce no duplicates',
      new Set(concurrent).size === 20, concurrent.length - new Set(concurrent).size);
    check('...and no gaps', sorted.join(',') === expected.join(','), sorted.join(','));

    check('number formatting pads to six digits, with no year',
      formatInvoiceNumber('FA', 123) === 'FA-000123' && formatInvoiceNumber('FA', 0) === 'FA-000000');
    const rows = await prisma.invoiceSeries.findMany({ where: { series: SERIES }, orderBy: { year: 'asc' } });
    check('one counter for good (year 0, at 22); the yearly row is untouched at 3',
      rows.length === 2 && rows[0].year === CONTINUOUS_YEAR && rows[0].last_number === 22
        && rows[1].year === YEAR && rows[1].last_number === 3,
      rows.map((r) => [r.year, r.last_number]));

    // Madrid, not UTC: 00:30 on 1 Jan CET is 31 Dec in UTC, and stamping the
    // UTC year would put the invoice in the wrong series.
    const newYearCET = new Date('2027-01-01T00:30:00+01:00');
    check('year is Madrid-local, not UTC', madridYear(newYearCET) === 2027,
      { madrid: madridYear(newYearCET), utc: newYearCET.getUTCFullYear() });

    // ─── Blockers ────────────────────────────────────────────
    const unconfigured = { ...DEFAULT_INVOICING };
    check('blank settings are not configured', !isInvoicingConfigured(unconfigured));
    const configured = { ...DEFAULT_INVOICING, legal_name: 'X SL', tax_id: 'B12345678', address: 'C/ 1' };
    check('filled settings are configured', isInvoicingConfigured(configured));

    const liveOrder = { status: 'pending', deleted_at: null };

    const allGood = invoiceBlockers({
      settings: configured, order: liveOrder, buyerTaxId: 'B99999999',
      unreviewedProductIds: [], alreadyInvoiced: false,
    });
    check('nothing blocking -> a real invoice', invoiceKindFor(allGood) === 'invoice', allGood);

    const noCif = invoiceBlockers({
      settings: unconfigured, order: liveOrder, buyerTaxId: 'B9',
      unreviewedProductIds: [], alreadyInvoiced: false,
    });
    check('no seller CIF -> albaran, not a refusal', invoiceKindFor(noCif) === 'albaran');
    check('...and it says which field is missing',
      noCif.some((b) => b.code === 'seller_not_configured'));

    const unreviewed = invoiceBlockers({
      settings: configured, order: liveOrder, buyerTaxId: 'B9',
      unreviewedProductIds: ['p1', 'p2'], alreadyInvoiced: false,
    });
    check('unreviewed VAT -> albaran', invoiceKindFor(unreviewed) === 'albaran');
    check('...and names the products to fix',
      unreviewed.find((b) => b.code === 'unreviewed_vat')?.product_ids?.length === 2);

    const noBuyerId = invoiceBlockers({
      settings: configured, order: liveOrder, buyerTaxId: null,
      unreviewedProductIds: [], alreadyInvoiced: false,
    });
    check('buyer without a tax id -> albaran', invoiceKindFor(noBuyerId) === 'albaran');

    const cancelled = invoiceBlockers({
      settings: configured, order: { status: 'cancelled', deleted_at: null },
      buyerTaxId: 'B9', unreviewedProductIds: [], alreadyInvoiced: false,
    });
    check('a cancelled order cannot be invoiced AT ALL', invoiceKindFor(cancelled) === null);

    // An existing FACTURA is a hard stop — one fiscal document per sale, and
    // the correction is a credit note.
    const dup = invoiceBlockers({
      settings: configured, order: liveOrder, buyerTaxId: 'B9',
      unreviewedProductIds: [], alreadyInvoiced: true,
    });
    check('an order that already has a FACTURA is a hard stop', invoiceKindFor(dup) === null);

    // A DRAFT order can be quoted but never invoiced. Both halves matter:
    // billing for goods that were never reserved is wrong, and refusing a
    // rep the quote they are standing at the counter to hand over would be
    // its own bug.
    const draftOrder = invoiceBlockers({
      settings: configured, order: { status: 'draft', deleted_at: null }, buyerTaxId: 'B9',
      unreviewedProductIds: [], alreadyInvoiced: false,
    });
    check('a DRAFT order can still be quoted', invoiceKindFor(draftOrder) === 'albaran');
    check(
      '  ...and says why, rather than just refusing',
      draftOrder.some((b) => b.code === 'order_draft' && b.albaran_ok),
      draftOrder.map((b) => b.code),
    );

    // A cancelled or deleted order is a hard stop — neither can be quoted.
    for (const [label, order] of [
      ['cancelled', { status: 'cancelled', deleted_at: null }],
      ['deleted', { status: 'pending', deleted_at: new Date() }],
    ] as const) {
      const b = invoiceBlockers({
        settings: configured, order, buyerTaxId: 'B9',
        unreviewedProductIds: [], alreadyInvoiced: false,
      });
      check(`a ${label} order cannot be quoted either`, invoiceKindFor(b) === null);
    }

    // An existing ALBARÁN is not, and this is the case that matters while
    // albaranes are the working document: the order moves on after a quote
    // goes out, and the rep has to be able to hand over a new one. If this
    // ever flips, a rep is stuck with a document that no longer matches the
    // order and no way to replace it.
    const afterAlbaran = invoiceBlockers({
      settings: configured, order: liveOrder, buyerTaxId: 'B9',
      unreviewedProductIds: [], alreadyInvoiced: false,
    });
    check('an order that already has a ALBARÁN can be issued again', invoiceKindFor(afterAlbaran) === 'invoice');

    // ...and with the fiscal blockers still open, the reissue is another
    // albaran rather than being refused outright.
    const reissueUnconfigured = invoiceBlockers({
      settings: unconfigured, order: liveOrder, buyerTaxId: null,
      unreviewedProductIds: ['p1'], alreadyInvoiced: false,
    });
    check('the reissue is an albarán while the CIF is missing', invoiceKindFor(reissueUnconfigured) === 'albaran');

    // ─── Lines and totals ────────────────────────────────────
    const built = buildInvoiceLines({
      items: [
        {
          product_id: 'a', quantity: 2,
          unit_price: new Prisma.Decimal('1.50'), line_total: new Prisma.Decimal('3.00'),
          product_snapshot: { name_es: 'Pan' },
          product: { name_es: 'Pan', vat_category: 'super_reduced', vat_category_reviewed: true },
        },
        {
          product_id: 'b', quantity: 1,
          unit_price: new Prisma.Decimal('10.00'), line_total: new Prisma.Decimal('10.00'),
          product_snapshot: { name_es: 'Vino' },
          product: { name_es: 'Vino', vat_category: 'general', vat_category_reviewed: true },
        },
      ],
      delivery_fee: new Prisma.Decimal('3.50'),
    });

    check('delivery becomes a taxed line, not an untaxed extra',
      built.lines.length === 3 && built.lines[2].description === 'Gastos de envío');
    check('delivery is taxed at the general rate', built.lines[2].rate_pct === 21);
    check('each line carries its own rate',
      built.lines[0].rate_pct === 4 && built.lines[1].rate_pct === 21);
    check('gross total equals the order total', built.totals.gross === '16.50', built.totals.gross);
    // The reconciliation that matters on every invoice.
    const base = Number(built.totals.base);
    const vat = Number(built.totals.vat);
    check('base + vat === gross, to the cent',
      Math.round((base + vat) * 100) === 1650, { base, vat });
    check('one totals row per rate present', built.totals.by_rate.length === 2);

    // ─── Immutability, enforced by the database ──────────────
    // Must be an order with no issued invoice already — the partial unique
    // index allows exactly one, and a leftover from an earlier run would
    // otherwise look like a test failure rather than stale data.
    const order = await prisma.order.findFirst({
      where: { invoices: { none: { status: 'issued' } } },
      select: { id: true, user_id: true },
    });
    const user = order ? { id: order.user_id } : null;

    if (order && user) {
      orderId = order.id;
      userId = user.id;
      const issued = await prisma.invoice.create({
        data: {
          kind: 'albaran', status: 'issued',
          series: SERIES, year: YEAR, number: 9001,
          invoice_number: formatInvoiceNumber(SERIES, 9001),
          issue_date: new Date(),
          order_id: order.id, user_id: user.id,
          seller_snapshot: {}, buyer_snapshot: {}, lines: [], totals: {},
          taxable_base: new Prisma.Decimal('10.00'),
          vat_total: new Prisma.Decimal('1.00'),
          total: new Prisma.Decimal('11.00'),
        },
      });
      invoiceIds.push(issued.id);

      let mutationBlocked = false;
      try {
        await prisma.invoice.update({
          where: { id: issued.id }, data: { total: new Prisma.Decimal('999.00') },
        });
      } catch { mutationBlocked = true; }
      check('the DATABASE refuses to change an issued total', mutationBlocked);

      let deleteBlocked = false;
      try {
        await prisma.invoice.delete({ where: { id: issued.id } });
      } catch { deleteBlocked = true; }
      check('the DATABASE refuses to delete an issued invoice', deleteBlocked);

      // Operational metadata must still be writable.
      let notesOk = true;
      try {
        await prisma.invoice.update({ where: { id: issued.id }, data: { notes: 'paid in cash' } });
      } catch { notesOk = false; }
      check('...but notes can still be recorded against it', notesOk);

      // The partial unique index is now ONE FACTURA per order, not one
      // document. Both halves matter and both are asserted, because the
      // index is the only thing enforcing either.
      //
      // The row created above is a ALBARÁN, so a second albaran must be
      // allowed — the order moves on after a quote and the rep reissues.
      let secondAlbaranOk = true;
      try {
        const second = await prisma.invoice.create({
          data: {
            kind: 'albaran', status: 'issued',
            series: SERIES, year: YEAR, number: 9002,
            invoice_number: formatInvoiceNumber(SERIES, 9002),
            issue_date: new Date(),
            order_id: order.id, user_id: user.id,
            seller_snapshot: {}, buyer_snapshot: {}, lines: [], totals: {},
            taxable_base: new Prisma.Decimal('1'), vat_total: new Prisma.Decimal('0'),
            total: new Prisma.Decimal('1'),
          },
        });
        invoiceIds.push(second.id);
      } catch { secondAlbaranOk = false; }
      check('a second issued ALBARÁN for one order is allowed', secondAlbaranOk);

      // A factura alongside them is fine — that is the quote-then-invoice
      // progression. A SECOND factura is not.
      let firstFacturaOk = true;
      try {
        const fac = await prisma.invoice.create({
          data: {
            kind: 'invoice', status: 'issued',
            series: 'ZF', year: YEAR, number: 9003,
            invoice_number: formatInvoiceNumber('ZF', 9003),
            issue_date: new Date(),
            order_id: order.id, user_id: user.id,
            seller_snapshot: {}, buyer_snapshot: {}, lines: [], totals: {},
            taxable_base: new Prisma.Decimal('1'), vat_total: new Prisma.Decimal('0'),
            total: new Prisma.Decimal('1'),
          },
        });
        invoiceIds.push(fac.id);
      } catch { firstFacturaOk = false; }
      check('a FACTURA may follow an albarán on the same order', firstFacturaOk);

      let secondFacturaBlocked = false;
      try {
        const dupe = await prisma.invoice.create({
          data: {
            kind: 'invoice', status: 'issued',
            series: 'ZF', year: YEAR, number: 9004,
            invoice_number: formatInvoiceNumber('ZF', 9004),
            issue_date: new Date(),
            order_id: order.id, user_id: user.id,
            seller_snapshot: {}, buyer_snapshot: {}, lines: [], totals: {},
            taxable_base: new Prisma.Decimal('1'), vat_total: new Prisma.Decimal('0'),
            total: new Prisma.Decimal('1'),
          },
        });
        invoiceIds.push(dupe.id);
      } catch { secondFacturaBlocked = true; }
      check('a second issued FACTURA for one order is refused', secondFacturaBlocked);
    } else {
      console.log('  SKIP  database immutability (no seeded order to attach to)');
    }

    // ─── A purchase flattened into one basket ────────────────
    // The delivery fee here is the bug this exists to catch. Checkout puts
    // the WHOLE fee on the parent and writes 0 on every sub-order, so
    // summing the subs yields zero and the document drops a fee the
    // customer is being charged. It cost 3.50 EUR on every seeded staging
    // purchase before it was found.
    const fakeParent = {
      delivery_fee_total: new Prisma.Decimal('3.50'),
      sub_orders: [
        { status: 'delivered' as const, deleted_at: null, items: [{ a: 1 }, { a: 2 }],
          address_snapshot: { city: 'Madrid' }, delivery_fee: new Prisma.Decimal('0') },
        { status: 'preparing' as const, deleted_at: null, items: [{ a: 3 }],
          address_snapshot: { city: 'Madrid' }, delivery_fee: new Prisma.Decimal('0') },
      ],
    };
    const basket = purchaseAsOneBasket(fakeParent);
    check('the purchase carries the PARENT delivery fee, not the zeros on its subs',
      basket.delivery_fee.toString() === '3.5', basket.delivery_fee.toString());
    check('items from every shop land in one basket', basket.items.length === 3, basket.items.length);
    check('the status is derived from the subs', basket.status === 'preparing', basket.status);
    check('the address comes from the first sub',
      (basket.address_snapshot as { city?: string }).city === 'Madrid');

    // A DELETED shop is not supplied, so it must not be billed. One part of
    // a purchase can be deleted on its own, and the document then charged for
    // goods nobody is sending — the fee bug above, in reverse.
    const oneShopGone = purchaseAsOneBasket({
      ...fakeParent,
      sub_orders: [
        { ...fakeParent.sub_orders[0], deleted_at: new Date() },
        fakeParent.sub_orders[1],
      ],
    });
    check('a deleted shop contributes NO items to the document',
      oneShopGone.items.length === 1, oneShopGone.items.length);
    check('...and the fee still stands, the rest is still delivered',
      oneShopGone.delivery_fee.toString() === '3.5');
    check('...and the status comes from what is still live',
      oneShopGone.status === 'preparing', oneShopGone.status);

    // A purchase is gone only when every part of it is.
    const halfDeleted = purchaseAsOneBasket({
      ...fakeParent,
      sub_orders: [
        { ...fakeParent.sub_orders[0], deleted_at: new Date() },
        fakeParent.sub_orders[1],
      ],
    });
    check('one deleted shop does NOT delete the purchase', halfDeleted.deleted_at === null);
    const allDeleted = purchaseAsOneBasket({
      ...fakeParent,
      sub_orders: fakeParent.sub_orders.map((x) => ({ ...x, deleted_at: new Date() })),
    });
    check('...but every shop deleted does', allDeleted.deleted_at !== null);

    // And the invariant that matters on the document itself: base + vat must
    // equal the purchase total, fee included.
    const feeLines = buildInvoiceLines({
      items: [{
        quantity: 1,
        unit_price: new Prisma.Decimal('10.00'),
        line_total: new Prisma.Decimal('10.00'),
        product_snapshot: { name_es: 'Cosa' },
        product: { vat_category: 'general' as const, name_es: 'Cosa' },
      }],
      delivery_fee: basket.delivery_fee,
    } as unknown as Parameters<typeof buildInvoiceLines>[0]);
    check('the fee reaches the document as a line',
      feeLines.totals.gross === '13.50', feeLines.totals.gross);

    // ─── One document per PURCHASE, not per shop ─────────────
    // A split purchase is one ParentOrder with a sub-order per shop. The
    // customer made ONE purchase, so it gets one albaran and one factura
    // covering all of it — the document hangs off the parent and the
    // sub-orders carry none of their own.
    const parent = await prisma.parentOrder.findFirst({
      where: { sub_orders: { some: {} } },
      select: { id: true, user_id: true, sub_orders: { select: { id: true }, take: 1 } },
    });

    if (parent) {
      const sub = parent.sub_orders[0];

      // The CHECK constraint: a document names ONE subject. Attaching it to
      // both an order and a purchase would double-count the same goods, and
      // attaching it to neither orphans it.
      const subjectCases: [string, object][] = [
        ['both an order AND a purchase', { order_id: sub.id, parent_order_id: parent.id }],
        ['neither an order nor a purchase', { order_id: null, parent_order_id: null }],
      ];
      for (const [label, subject] of subjectCases) {
        let refused = false;
        try {
          const bad = await prisma.invoice.create({
            data: {
              kind: 'albaran', status: 'draft',
              ...subject, user_id: parent.user_id,
              seller_snapshot: {}, buyer_snapshot: {}, lines: [], totals: {},
              taxable_base: new Prisma.Decimal('1'), vat_total: new Prisma.Decimal('0'),
              total: new Prisma.Decimal('1'),
            } as Prisma.InvoiceUncheckedCreateInput,
          });
          invoiceIds.push(bad.id);
        } catch { refused = true; }
        check(`a document naming ${label} is refused`, refused);
      }

      // Clear any factura left on this purchase by an earlier run, or the
      // index below would refuse the FIRST one and read as a failure.
      const priorFactura = await prisma.invoice.findFirst({
        where: { parent_order_id: parent.id, status: 'issued', kind: 'invoice' },
        select: { id: true },
      });

      if (!priorFactura) {
        let firstOk = true;
        try {
          const fac = await prisma.invoice.create({
            data: {
              kind: 'invoice', status: 'issued',
              series: SERIES, year: YEAR, number: 9101,
              invoice_number: formatInvoiceNumber(SERIES, 9101),
              issue_date: new Date(),
              order_id: null, parent_order_id: parent.id, user_id: parent.user_id,
              seller_snapshot: {}, buyer_snapshot: {}, lines: [], totals: {},
              taxable_base: new Prisma.Decimal('1'), vat_total: new Prisma.Decimal('0'),
              total: new Prisma.Decimal('1'),
            },
          });
          invoiceIds.push(fac.id);
        } catch (e) { firstOk = false; check('  (first purchase factura)', false, String(e)); }
        check('a FACTURA can be issued for a whole purchase', firstOk);

        let dupeBlocked = false;
        try {
          const dupe = await prisma.invoice.create({
            data: {
              kind: 'invoice', status: 'issued',
              series: SERIES, year: YEAR, number: 9102,
              invoice_number: formatInvoiceNumber(SERIES, 9102),
              issue_date: new Date(),
              order_id: null, parent_order_id: parent.id, user_id: parent.user_id,
              seller_snapshot: {}, buyer_snapshot: {}, lines: [], totals: {},
              taxable_base: new Prisma.Decimal('1'), vat_total: new Prisma.Decimal('0'),
              total: new Prisma.Decimal('1'),
            },
          });
          invoiceIds.push(dupe.id);
        } catch { dupeBlocked = true; }
        check('a second issued FACTURA for one PURCHASE is refused', dupeBlocked);

        // THE REGRESSION THIS GUARDS. The edit and delete guards ask
        // issuedFacturaFor(), which must look at the purchase as well as the
        // order. A guard that only asked `order_id` would find nothing here
        // — and go blind on exactly the orders that ARE invoiced, letting a
        // rep edit or hide one shop's part of a purchase whose total is
        // already stated on a document the customer is holding.
        const viaSub = await prisma.$transaction((tx) =>
          issuedFacturaFor(tx, { id: sub.id, parent_order_id: parent.id }));
        check("a sub-order finds its PURCHASE's factura", viaSub !== null, viaSub);

        // ...and it must not reach across unrelated orders.
        const loose = await prisma.$transaction((tx) =>
          issuedFacturaFor(tx, { id: sub.id, parent_order_id: null }));
        check('a standalone order does NOT inherit it', loose === null, loose);
      } else {
        console.log('  SKIP  purchase-level factura (one is already issued)');
      }
    } else {
      console.log('  SKIP  purchase-level rules (no split purchase seeded)');
    }
  } finally {
    if (invoiceIds.length) {
      // The triggers block BOTH demoting and deleting an issued row — they
      // even refuse this cleanup, which is the clearest evidence they work.
      // Disabling them for the delete is the only way out, and is exactly
      // the privilege no application code path has.
      await prisma.$executeRawUnsafe('ALTER TABLE invoices DISABLE TRIGGER invoices_no_mutate_issued');
      await prisma.$executeRawUnsafe('ALTER TABLE invoices DISABLE TRIGGER invoices_no_delete_issued');
      try {
        await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
      } finally {
        await prisma.$executeRawUnsafe('ALTER TABLE invoices ENABLE TRIGGER invoices_no_mutate_issued');
        await prisma.$executeRawUnsafe('ALTER TABLE invoices ENABLE TRIGGER invoices_no_delete_issued');
      }
    }
    await prisma.invoiceSeries.deleteMany({ where: { series: SERIES } });
    await prisma.$disconnect();
  }

  console.log(`\n${passed}/${passed + failed} passed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
