// ─── Integration test · a rep's own albaranes, and no facturas ─────────────
//
// Run:  cd packages/api && npm run test:sales-invoices
//
// A rep drafts, issues and reads their own documents. Three things make that
// worth testing rather than trusting:
//
//   · SCOPE. The rules live in a lib shared with admin, which checks nothing
//     about who is asking — by design, because a lib that sometimes enforces
//     scope is worse than one that never does. Every check therefore lives in
//     these routes, and a rep reaching another rep's factura is the failure
//     that matters most.
//   · THE LINE BETWEEN THE TWO DOCUMENTS. A rep makes and reads albaranes. A
//     factura is the office's alone (2026-11-07): asking for one, issuing one
//     admin left in draft, reading or downloading one, and learning its number
//     from any answer about the order are all refused, and pressing Albarán
//     must leave the office's draft exactly as it was.
//   · A PART OF A SPLIT PURCHASE. The client made one purchase; a document
//     per shop would hand them three albaranes for one basket.
//
// Goes through the real routes over HTTP. Creates its own fixtures and
// removes them in a finally.

import http from 'http';
import app from '../../server';
import prisma from '../../lib/prisma';
import { Prisma } from '@prisma/client';
import { generateAccessToken } from '../../lib/jwt';
import { busiestShop, repShop } from '../../lib/testRepShop';
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

interface Blocker { code: string; message: string; albaran_ok: boolean }
interface Body {
  data?: {
    invoice?: {
      id: string; kind: string; status: string; invoice_number: string | null;
      created_by_sales_rep_id?: string | null;
      issued_by_sales_rep_id?: string | null;
    };
    blockers?: Blocker[];
    kind?: string;
    parent_order_id?: string;
  } & Record<string, unknown>;
  error?: string;
}

async function main() {
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

  const userIds: string[] = [];
  const orderIds: string[] = [];
  const parentIds: string[] = [];
  const invoiceIds: string[] = [];
  let addressId: string | null = null;

  try {
    const call = async (
      path: string,
      init: { method?: string; body?: unknown; token: string },
    ) => {
      const res = await fetch(`${base}${path}`, {
        method: init.method ?? 'GET',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${init.token}` },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
      return { status: res.status, body: await res.json() as Body };
    };

    // ─── Fixtures ────────────────────────────────────────────
    const mkUser = async (label: string) =>
      prisma.user.create({
        data: {
          name: `QA ${label} ${stamp}`,
          email: `qa.inv.${label.toLowerCase()}.${stamp}@cesto.test`,
          phone: `+346${String(Math.floor(Math.random() * 90000000) + 10000000)}`,
        },
        select: { id: true, name: true, email: true },
      });

    // A rep sells from one shop (lib/repStore); the order below comes from it.
    const shopId = await busiestShop({ stock_quantity: { gte: 5 } });
    const rep = await mkUser('Rep');
    userIds.push(rep.id);
    await prisma.salesRep.create({ data: { user_id: rep.id, code: `QA-INV-${stamp}`, ...repShop(shopId) } });
    const token = generateAccessToken({ userId: rep.id, email: rep.email ?? undefined });

    // A SECOND rep, to prove scope with. Their order is built by them, so
    // every route here must refuse it to the first.
    const other = await mkUser('Other');
    userIds.push(other.id);
    await prisma.salesRep.create({ data: { user_id: other.id, code: `QA-INV2-${stamp}`, ...repShop(shopId) } });

    // No tax_id, deliberately: that is the blocker that refuses a factura
    // without depending on how this database happens to be configured.
    //
    // Opened BY the rep, because a rep can only build an order for a client in
    // their own book — one they opened, or one they have already sold to. A
    // plain customer answers "Client not found", which is the scoping working.
    const client = await prisma.user.create({
      data: {
        name: `QA Client ${stamp}`,
        email: `qa.inv.client.${stamp}@cesto.test`,
        phone: `+346${String(Math.floor(Math.random() * 90000000) + 10000000)}`,
        created_by_sales_rep_id: rep.id,
      },
      select: { id: true },
    });
    userIds.push(client.id);

    const address = await prisma.address.create({
      data: {
        user_id: client.id, contact_name: 'QA', contact_phone: '600000000',
        street_line_1: 'C/ Test 1', postcode: '28016', city: 'Madrid', province: 'Madrid',
      },
      select: { id: true },
    });
    addressId = address.id;

    const variant = await prisma.productVariant.findFirst({
      where: { is_active: true, product: { is_active: true, store_id: shopId }, stock_quantity: { gte: 5 } },
      select: { id: true },
    });
    if (!variant) { console.log('  SKIP  no sellable variant in this database'); return; }

    // Built through the rep's own endpoint, so it is theirs the way a real
    // one is rather than by a column this test set by hand.
    const made = await call('/api/sales/orders', {
      method: 'POST', token,
      body: { user_id: client.id, address_id: address.id, items: [{ variant_id: variant.id, quantity: 2 }] },
    });
    // `{ order, delivery_fee_resolved, delivery_fee_applied }`, not the order
    // itself — the fee the server settled on is part of the answer.
    const orderId = (made.body.data as { order?: { id: string } } | undefined)?.order?.id;
    check('the rep builds an order to document', made.status === 201 && !!orderId,
      { status: made.status, error: made.body.error });
    if (!orderId) return;
    orderIds.push(orderId);

    // ─── 1. An albarán ───────────────────────────────────────
    const draft = await call(`/api/sales/orders/${orderId}/invoice`, {
      method: 'POST', token, body: { kind: 'albaran' },
    });
    check('a rep can draft an albarán for their own order',
      draft.status === 201 && draft.body.data?.invoice?.kind === 'albaran',
      { status: draft.status, error: draft.body.error, kind: draft.body.data?.invoice?.kind });

    const draftId = draft.body.data?.invoice?.id;
    if (!draftId) return;
    invoiceIds.push(draftId);
    check('...recorded as the rep’s own work',
      draft.body.data?.invoice?.created_by_sales_rep_id === rep.id,
      draft.body.data?.invoice?.created_by_sales_rep_id);

    // Pressing twice must not stack a second document to choose between.
    const again = await call(`/api/sales/orders/${orderId}/invoice`, {
      method: 'POST', token, body: { kind: 'albaran' },
    });
    check('...and drafting twice hands back the SAME draft',
      again.body.data?.invoice?.id === draftId,
      { first: draftId, second: again.body.data?.invoice?.id });

    // ─── 2. A factura is not theirs to make ──────────────────
    //
    // Refused on the way in, by policy, not by the blockers. The blockers
    // would refuse this particular order anyway — the client has no CIF — and
    // that is exactly why the check has to be the policy: an order that
    // satisfied every blocker would otherwise get a fiscal number from a rep.
    const factura = await call(`/api/sales/orders/${orderId}/invoice`, {
      method: 'POST', token, body: { kind: 'invoice' },
    });
    check('a rep asking for a factura is refused', factura.status === 403,
      { status: factura.status, error: factura.body.error });
    check('...and told which document is theirs',
      /albar/i.test(factura.body.error ?? ''), factura.body.error);

    // The one admin drafts stays admin's to issue. A rep reaching it would
    // burn a fiscal number and close the order to every further document.
    const adminDraft = await prisma.invoice.create({
      data: {
        kind: 'invoice', status: 'draft',
        order_id: orderId, user_id: client.id,
        seller_snapshot: {}, buyer_snapshot: {}, lines: [], totals: {},
        taxable_base: new Prisma.Decimal(0),
        vat_total: new Prisma.Decimal(0),
        total: new Prisma.Decimal(0),
      },
      select: { id: true },
    });
    invoiceIds.push(adminDraft.id);

    const issueFactura = await call(`/api/sales/invoices/${adminDraft.id}/issue`, {
      method: 'POST', token,
    });
    check("issuing a factura admin drafted on the rep's own order is refused",
      issueFactura.status === 404,
      { status: issueFactura.status, error: issueFactura.body.error });
    const readFactura = await call(`/api/sales/invoices/${adminDraft.id}`, { token });
    check('...and the rep cannot READ it either',
      readFactura.status === 404,
      { status: readFactura.status, error: readFactura.body.error });

    // Pressing Albarán used to find the office's draft, turn it into an albarán
    // and issue it, taking the office's hand-typed lines with it.
    const besideDraft = await call(`/api/sales/orders/${orderId}/invoice`, {
      method: 'POST', token, body: { kind: 'albaran' },
    });
    check("pressing Albarán beside the office's draft hands back the rep's own",
      besideDraft.body.data?.invoice?.id === draftId && besideDraft.body.data?.invoice?.kind === 'albaran',
      besideDraft.body.data?.invoice);
    const officeDraft = await prisma.invoice.findUnique({
      where: { id: adminDraft.id }, select: { kind: true, status: true },
    });
    check("...and the office's draft is still a factura draft",
      officeDraft?.kind === 'invoice' && officeDraft?.status === 'draft', officeDraft);

    // ─── 3. Issuing allocates a number ───────────────────────
    const issued = await call(`/api/sales/invoices/${draftId}/issue`, { method: 'POST', token });
    check('a rep can issue their own albarán', issued.status === 200,
      { status: issued.status, error: issued.body.error });
    check('...which gets a number from the series',
      !!issued.body.data?.invoice?.invoice_number,
      issued.body.data?.invoice?.invoice_number);
    check('...and records who issued it',
      issued.body.data?.invoice?.issued_by_sales_rep_id === rep.id,
      issued.body.data?.invoice?.issued_by_sales_rep_id);

    const twice = await call(`/api/sales/invoices/${draftId}/issue`, { method: 'POST', token });
    check('...and issuing the same one twice is refused', twice.status === 409,
      { status: twice.status, error: twice.body.error });

    // No albarán draft left now, only the office's: the case that used to take it.
    const newAlbaran = await call(`/api/sales/orders/${orderId}/invoice`, {
      method: 'POST', token, body: { kind: 'albaran' },
    });
    const newAlbaranId = newAlbaran.body.data?.invoice?.id;
    if (newAlbaranId) invoiceIds.push(newAlbaranId);
    check("a new albarán is its own document, not the office's draft",
      newAlbaran.status === 201 && !!newAlbaranId && newAlbaranId !== adminDraft.id
      && newAlbaran.body.data?.invoice?.kind === 'albaran',
      { status: newAlbaran.status, invoice: newAlbaran.body.data?.invoice });
    const stillOffice = await prisma.invoice.findUnique({
      where: { id: adminDraft.id }, select: { kind: true, status: true },
    });
    check("...and the office's draft is still untouched",
      stillOffice?.kind === 'invoice' && stillOffice?.status === 'draft', stillOffice);

    // ─── 4. Reading it back, to print it ─────────────────────
    const read = await call(`/api/sales/invoices/${draftId}`, { token });
    check('the rep can read the document back', read.status === 200,
      { status: read.status, error: read.body.error });
    const doc = read.body.data as unknown as Record<string, unknown> | undefined;
    check('...carrying everything the PDF prints',
      !!doc?.seller_snapshot && !!doc?.buyer_snapshot
      && Array.isArray(doc?.lines) && !!doc?.totals && !!doc?.invoice_number,
      Object.keys(doc ?? {}));

    // ─── 5. Somebody else's document is a 404 ────────────────
    const theirOrder = await prisma.order.create({
      data: {
        order_number: generateOrderNumber(),
        user_id: client.id, address_id: address.id, address_snapshot: {},
        payment_method: 'cod', status: 'pending',
        subtotal: new Prisma.Decimal('10.00'),
        delivery_fee: new Prisma.Decimal(0),
        total: new Prisma.Decimal('10.00'),
        created_by_sales_rep_id: other.id,
      },
      select: { id: true },
    });
    orderIds.push(theirOrder.id);

    const poach = await call(`/api/sales/orders/${theirOrder.id}/invoice`, {
      method: 'POST', token, body: { kind: 'albaran' },
    });
    check("drafting on another rep's order is refused", poach.status === 404,
      { status: poach.status, error: poach.body.error });

    const theirDoc = await prisma.invoice.create({
      data: {
        kind: 'albaran', status: 'draft',
        order_id: theirOrder.id, user_id: client.id,
        seller_snapshot: {}, buyer_snapshot: {}, lines: [], totals: {},
        taxable_base: new Prisma.Decimal(0),
        vat_total: new Prisma.Decimal(0),
        total: new Prisma.Decimal(0),
        created_by_sales_rep_id: other.id,
      },
      select: { id: true },
    });
    invoiceIds.push(theirDoc.id);

    const peek = await call(`/api/sales/invoices/${theirDoc.id}`, { token });
    check("...reading another rep's document is a 404, not a 403", peek.status === 404,
      { status: peek.status, error: peek.body.error });
    const forge = await call(`/api/sales/invoices/${theirDoc.id}/issue`, { method: 'POST', token });
    check("...and issuing it is refused too", forge.status === 404,
      { status: forge.status, error: forge.body.error });

    // ─── 5b. An issued factura, as far as a rep can tell ─────
    const invoicedOrder = await prisma.order.create({
      data: {
        order_number: generateOrderNumber(),
        user_id: client.id, address_id: address.id, address_snapshot: {},
        payment_method: 'cod', status: 'pending',
        subtotal: new Prisma.Decimal('10.00'),
        delivery_fee: new Prisma.Decimal(0),
        total: new Prisma.Decimal('10.00'),
        created_by_sales_rep_id: rep.id,
      },
      select: { id: true },
    });
    orderIds.push(invoicedOrder.id);
    const facturaNumber = `QAF-2099-${stamp}`;
    const issuedFactura = await prisma.invoice.create({
      data: {
        kind: 'invoice', status: 'issued',
        series: 'QAF', year: 2099, number: Number(stamp),
        invoice_number: facturaNumber, issue_date: new Date(),
        order_id: invoicedOrder.id, user_id: client.id,
        seller_snapshot: {}, buyer_snapshot: {}, lines: [], totals: {},
        taxable_base: new Prisma.Decimal('10'), vat_total: new Prisma.Decimal('0'),
        total: new Prisma.Decimal('10'),
      },
      select: { id: true },
    });
    invoiceIds.push(issuedFactura.id);
    const leaks = (r: { body: Body }) => JSON.stringify(r.body).includes(facturaNumber)
      || JSON.stringify(r.body).includes(issuedFactura.id);

    const invoicedRead = await call(`/api/sales/orders/${invoicedOrder.id}`, { token });
    const invoicedData = invoicedRead.body.data as { invoices?: unknown[]; factura_issued?: boolean } | undefined;
    check('an invoiced order tells the rep it is invoiced',
      invoicedData?.factura_issued === true, invoicedData?.factura_issued);
    check('...but lists no factura', invoicedData?.invoices?.length === 0, invoicedData?.invoices);
    check('...and neither its number nor its id is anywhere in the answer', !leaks(invoicedRead));

    const openRead = await call(`/api/sales/orders/${orderId}`, { token });
    const openData = openRead.body.data as { invoices?: Array<{ kind: string }>; factura_issued?: boolean } | undefined;
    check("an order with only the office's DRAFT is not invoiced",
      openData?.factura_issued === false, openData?.factura_issued);
    check('...and its documents are albaranes only',
      !!openData?.invoices?.length && openData.invoices.every((d) => d.kind === 'albaran'), openData?.invoices);

    const readIssued = await call(`/api/sales/invoices/${issuedFactura.id}`, { token });
    check('downloading an issued factura is a 404', readIssued.status === 404 && !leaks(readIssued),
      { status: readIssued.status, error: readIssued.body.error });

    const onInvoiced = await call(`/api/sales/orders/${invoicedOrder.id}/invoice`, {
      method: 'POST', token, body: { kind: 'albaran' },
    });
    check('no albarán after a factura, and the refusal does not name it',
      onInvoiced.status === 422 && !leaks(onInvoiced),
      { status: onInvoiced.status, body: onInvoiced.body });

    const feeOnInvoiced = await call(`/api/sales/orders/${invoicedOrder.id}/delivery-fee`, {
      method: 'PUT', token, body: { delivery_fee: 3 },
    });
    check('the fee on an invoiced order is refused without naming the factura',
      feeOnInvoiced.status === 409 && !leaks(feeOnInvoiced),
      { status: feeOnInvoiced.status, error: feeOnInvoiced.body.error });

    const cancelInvoiced = await call(`/api/sales/orders/${invoicedOrder.id}/cancel`, {
      method: 'PUT', token, body: { reason: 'QA' },
    });
    const afterCancel = await prisma.order.findUnique({ where: { id: invoicedOrder.id }, select: { status: true } });
    check('cancelling an invoiced order is refused without naming the factura',
      cancelInvoiced.status === 409 && !leaks(cancelInvoiced),
      { status: cancelInvoiced.status, error: cancelInvoiced.body.error });
    check('...and the order is still pending', afterCancel?.status === 'pending', afterCancel?.status);

    // ─── 6. A part of a split purchase has no document ───────
    const parent = await prisma.parentOrder.create({
      data: {
        order_number: generateParentOrderNumber(),
        user_id: client.id, address_id: address.id, payment_method: 'cod',
        address_snapshot: {},
        subtotal: new Prisma.Decimal('10.00'),
        delivery_fee_total: new Prisma.Decimal(0),
        total: new Prisma.Decimal('10.00'),
      },
      select: { id: true },
    });
    parentIds.push(parent.id);

    const part = await prisma.order.create({
      data: {
        order_number: generateOrderNumber(),
        user_id: client.id, address_id: address.id, address_snapshot: {},
        payment_method: 'cod', status: 'pending',
        subtotal: new Prisma.Decimal('10.00'),
        delivery_fee: new Prisma.Decimal(0),
        total: new Prisma.Decimal('10.00'),
        created_by_sales_rep_id: rep.id,
        parent_order_id: parent.id,
      },
      select: { id: true },
    });
    orderIds.push(part.id);

    const onPart = await call(`/api/sales/orders/${part.id}/invoice`, {
      method: 'POST', token, body: { kind: 'albaran' },
    });
    check('a part of a split purchase refuses a document of its own',
      onPart.status === 409, { status: onPart.status, error: onPart.body.error });
    check('...and says where the documents live',
      onPart.body.data?.parent_order_id === parent.id,
      onPart.body.data?.parent_order_id);

  } finally {
    // The triggers block BOTH demoting and deleting an issued row — they
    // even refuse this cleanup, which is the clearest evidence they work.
    // Disabling them for the delete is the only way out, and is exactly the
    // privilege no application code path has. Same shape as the teardown in
    // lib/invoicing.test.ts, for the same reason.
    await prisma.$executeRawUnsafe('ALTER TABLE invoices DISABLE TRIGGER invoices_no_mutate_issued');
    await prisma.$executeRawUnsafe('ALTER TABLE invoices DISABLE TRIGGER invoices_no_delete_issued');
    try {
      if (invoiceIds.length) await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
      // Any document the routes made that this test did not record by id.
      if (orderIds.length) await prisma.invoice.deleteMany({ where: { order_id: { in: orderIds } } });
      if (parentIds.length) await prisma.invoice.deleteMany({ where: { parent_order_id: { in: parentIds } } });
    } finally {
      await prisma.$executeRawUnsafe('ALTER TABLE invoices ENABLE TRIGGER invoices_no_mutate_issued');
      await prisma.$executeRawUnsafe('ALTER TABLE invoices ENABLE TRIGGER invoices_no_delete_issued');
    }
    if (orderIds.length) {
      await prisma.orderItem.deleteMany({ where: { order_id: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    if (parentIds.length) await prisma.parentOrder.deleteMany({ where: { id: { in: parentIds } } });
    await prisma.salesRep.deleteMany({ where: { user_id: { in: userIds } } });
    if (addressId) await prisma.address.deleteMany({ where: { id: addressId } });
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
