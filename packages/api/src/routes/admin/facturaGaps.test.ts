// ─── Integration test · a factura is drafted with gaps and issued once filled
//
// Run:  cd packages/api && npm run test:factura-gaps
//
// Three things used to refuse a factura outright: the company's fiscal details
// missing from Ajustes, a product whose IVA category nobody had ticked, and a
// customer with no CIF. Each one sent the admin to a different screen, and the
// document that wanted those three fields was sitting right there with a box
// for each of them — fully editable, and unreachable, because the refusal
// happened before the draft existed.
//
// So the question moved. A factura is now judged on ITSELF:
//
//   · drafting one with gaps WORKS, and the gaps come back named;
//   · `document_blockers` is the short list of what the document still needs,
//     separate from everything merely imperfect upstream;
//   · typing the CIF on the DRAFT is enough to issue — the customer record is
//     never touched, because the document is the statement, not the record;
//   · AN UNREVIEWED IVA CATEGORY NO LONGER STOPS ANYTHING. The rate is on the
//     line and the admin confirms it there, which is what reviewing means.
//
// What still refuses: cancelled, deleted, already invoiced, and an order that
// is still a stock draft. No field on a document makes those sales real.
//
// Goes through the real admin routes over HTTP. Makes its own fixtures and
// removes them, triggers and all.
import http from 'http';
import app from '../../server';
import prisma from '../../lib/prisma';
import { Prisma } from '@prisma/client';
import { generateAdminAccessToken } from '../../lib/jwt';
import { generateOrderNumber } from '../../lib/pagination';
import { documentBlockers } from '../../lib/invoicing';

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
const CIF = 'B12345678';

async function main() {
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

  const userIds: string[] = [];
  const orderIds: string[] = [];
  const invoiceIds: string[] = [];
  const productIds: string[] = [];
  let categoryId = '';

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

    // ─── 0. The document check, on its own ───────────────────
    //
    // A unit case, because the seller's details heal from settings on every
    // read of a draft — which is right, and means an HTTP path cannot produce
    // a document with a blank seller while the settings row is filled.
    const blankSeller = documentBlockers({
      seller_snapshot: {} as Prisma.JsonValue,
      buyer_snapshot: { tax_id: CIF } as unknown as Prisma.JsonValue,
    });
    check('a document with no seller details names them',
      blankSeller.length === 1 && blankSeller[0].code === 'seller_not_configured',
      blankSeller.map((b) => b.code));
    check('...and says it can be fixed on the document',
      blankSeller[0]?.fix_on_document === true);

    const complete = documentBlockers({
      seller_snapshot: { legal_name: 'Cesto SL', tax_id: 'B1', address: 'C/ 1' } as unknown as Prisma.JsonValue,
      buyer_snapshot: { tax_id: CIF } as unknown as Prisma.JsonValue,
    });
    check('a complete document has nothing left to fill', complete.length === 0, complete);

    const sellerByName = documentBlockers({
      // An older draft, written when the editor could only set `name`.
      seller_snapshot: { name: 'Cesto SL', tax_id: 'B1', address: 'C/ 1' } as unknown as Prisma.JsonValue,
      buyer_snapshot: { tax_id: CIF } as unknown as Prisma.JsonValue,
    });
    check('...and an older draft naming the seller as `name` still counts',
      sellerByName.length === 0, sellerByName);

    // ─── Fixtures: the exact situation that used to refuse ───
    const category = await prisma.category.create({
      data: { name_es: `FG ${stamp}`, name_en: `FG ${stamp}`, sort_order: 9999 },
      select: { id: true },
    });
    categoryId = category.id;

    // IVA DELIBERATELY NOT REVIEWED — this is the blocker under test.
    const product = await prisma.product.create({
      data: {
        name_es: `Arroz prueba ${stamp}`, name_en: `Test rice ${stamp}`,
        category_id: categoryId, is_active: true,
        vat_category: 'reduced', vat_category_reviewed: false,
        variants: {
          create: [{
            name_es: '1 kg', name_en: '1 kg',
            price: new Prisma.Decimal('10.00'), stock_quantity: 50, is_active: true,
          }],
        },
      },
      include: { variants: true },
    });
    productIds.push(product.id);
    const variant = product.variants[0];

    // A CUSTOMER WITH NO CIF — the second blocker under test.
    const user = await prisma.user.create({
      data: { name: `QA Factura ${stamp}`, email: `qa.factura.${stamp}@cesto.test`, tax_id: null },
      select: { id: true, tax_id: true },
    });
    userIds.push(user.id);
    const address = await prisma.address.create({
      data: {
        user_id: user.id, contact_name: 'QA', contact_phone: '600000006',
        street_line_1: 'C/ Factura 1', postcode: '28016', city: 'Madrid', province: 'Madrid',
      },
      select: { id: true },
    });

    const made = await call('/api/admin/orders', {
      method: 'POST', token,
      body: {
        user_id: user.id, address_id: address.id, delivery_fee: 0,
        items: [{ variant_id: variant.id, quantity: 2 }],
      },
    });
    const orderId = made.body.data?.order?.id as string | undefined;
    if (!orderId) { console.log('  ABORT  could not create the order', made.body.error); return; }
    orderIds.push(orderId);

    // ─── 1. The draft is created, gaps and all ──────────────
    const drafted = await call(`/api/admin/orders/${orderId}/invoice`, {
      method: 'POST', token, body: { kind: 'invoice' },
    });
    check('A FACTURA CAN BE DRAFTED WITH GAPS', drafted.status === 201 || drafted.status === 200,
      { status: drafted.status, error: drafted.body.error });
    check('...and it really is a factura, not a downgraded albarán',
      drafted.body.data?.kind === 'invoice' && drafted.body.data?.invoice?.kind === 'invoice',
      { kind: drafted.body.data?.kind, invoiceKind: drafted.body.data?.invoice?.kind });

    const invoiceId = drafted.body.data?.invoice?.id as string | undefined;
    if (!invoiceId) { console.log('  ABORT  no draft to work with'); return; }
    invoiceIds.push(invoiceId);

    const draftCodes = (drafted.body.data?.blockers ?? []).map((b: { code: string }) => b.code);
    check('...with the gaps named rather than hidden',
      draftCodes.includes('unreviewed_vat') && draftCodes.includes('buyer_tax_id_missing'),
      draftCodes);
    check('...each marked as something to fix on the document',
      (drafted.body.data?.blockers ?? [])
        .filter((b: { code: string }) => ['unreviewed_vat', 'buyer_tax_id_missing'].includes(b.code))
        .every((b: { fix_on_document: boolean }) => b.fix_on_document === true));

    // ─── 2. What the DOCUMENT still needs is the short list ──
    const read = await call(`/api/admin/invoices/${invoiceId}`, { token });
    const gaps = (read.body.data?.document_blockers ?? []).map((b: { code: string }) => b.code);
    check('the document gap is the buyer CIF', gaps.includes('buyer_tax_id_missing'), gaps);
    check('...and an UNREVIEWED IVA CATEGORY IS NOT ONE', !gaps.includes('unreviewed_vat'), gaps);

    // ─── 3. Still refused while the document is incomplete ──
    const tooEarly = await call(`/api/admin/invoices/${invoiceId}/issue`, { method: 'POST', token });
    check('issuing is refused while the CIF is missing', tooEarly.status === 422,
      { status: tooEarly.status, error: tooEarly.body.error });
    check('...and the refusal says the CIF is what is missing',
      /CIF/i.test(tooEarly.body.error ?? ''), { error: tooEarly.body.error });

    // ─── 4. Fill it in ON THE DOCUMENT ──────────────────────
    const typed = await call(`/api/admin/invoices/${invoiceId}`, {
      method: 'PUT', token, body: { buyer: { tax_id: CIF } },
    });
    check('the CIF can be typed on the draft', typed.status === 200,
      { status: typed.status, error: typed.body.error });

    const afterTyping = await call(`/api/admin/invoices/${invoiceId}`, { token });
    check('...and the document then has nothing left to fill',
      (afterTyping.body.data?.document_blockers ?? []).length === 0,
      afterTyping.body.data?.document_blockers);

    // ─── 5. ISSUE IT ────────────────────────────────────────
    const issued = await call(`/api/admin/invoices/${invoiceId}/issue`, { method: 'POST', token });
    check('THE FACTURA ISSUES, with the IVA category still unreviewed',
      issued.status === 200, { status: issued.status, error: issued.body.error });
    check('...as a factura, with a number', issued.body.data?.invoice?.kind === 'invoice'
      && !!issued.body.data?.invoice?.invoice_number,
      { kind: issued.body.data?.invoice?.kind, number: issued.body.data?.invoice?.invoice_number });

    const stored = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { status: true, kind: true, invoice_number: true, buyer_snapshot: true },
    });
    check('...and it is issued in the database, not just in the answer',
      stored?.status === 'issued' && stored?.kind === 'invoice', stored);
    check('...carrying the CIF that was typed on the document',
      (stored?.buyer_snapshot as Record<string, unknown>)?.tax_id === CIF,
      (stored?.buyer_snapshot as Record<string, unknown>)?.tax_id);

    // The document is the statement; the customer record is not evidence for
    // it and must not be quietly rewritten by issuing one.
    const userAfter = await prisma.user.findUnique({
      where: { id: user.id }, select: { tax_id: true },
    });
    check('THE CUSTOMER RECORD IS UNTOUCHED — the document is the statement',
      userAfter?.tax_id === null, userAfter);

    const productAfter = await prisma.product.findUnique({
      where: { id: product.id }, select: { vat_category_reviewed: true },
    });
    check('...and the product is still unreviewed, as it was',
      productAfter?.vat_category_reviewed === false, productAfter);

    // ─── 6. The seller name reaches the document ────────────
    //
    // A factura prints the seller as `legal_name`. The editor sent `name`, so
    // correcting the company name changed a field nothing rendered.
    const second = await call('/api/admin/orders', {
      method: 'POST', token,
      body: {
        user_id: user.id, address_id: address.id, delivery_fee: 0,
        items: [{ variant_id: variant.id, quantity: 1 }],
      },
    });
    const secondOrderId = second.body.data?.order?.id as string | undefined;
    if (secondOrderId) {
      orderIds.push(secondOrderId);
      const d2 = await call(`/api/admin/orders/${secondOrderId}/invoice`, {
        method: 'POST', token, body: { kind: 'invoice' },
      });
      const id2 = d2.body.data?.invoice?.id as string | undefined;
      if (id2) {
        invoiceIds.push(id2);
        const renamed = await call(`/api/admin/invoices/${id2}`, {
          method: 'PUT', token, body: { seller: { name: `Cesto QA ${stamp}` } },
        });
        check('the seller name can be corrected on the draft', renamed.status === 200,
          { status: renamed.status, error: renamed.body.error });
        const snap = (await prisma.invoice.findUnique({
          where: { id: id2 }, select: { seller_snapshot: true },
        }))?.seller_snapshot as Record<string, unknown>;
        check('...and lands on `legal_name`, WHICH IS WHAT THE PDF PRINTS',
          snap?.legal_name === `Cesto QA ${stamp}`, { legal_name: snap?.legal_name, name: snap?.name });
      }
    }

    // ─── 6b. A line the order does not have ─────────────────
    //
    // The screen could only edit the lines that were already there, while the
    // route has always taken the list as a whole. A pallet charge is the
    // ordinary case: it is on the document, not in the basket.
    if (secondOrderId) {
      const id2 = invoiceIds[invoiceIds.length - 1];
      const before = await prisma.invoice.findUnique({
        where: { id: id2 }, select: { lines: true, total: true },
      });
      const existing = (before?.lines ?? []) as unknown as Array<Record<string, unknown>>;
      const withExtra = await call(`/api/admin/invoices/${id2}`, {
        method: 'PUT', token,
        body: {
          lines: [
            ...existing.map((l) => ({
              description: String(l.description),
              quantity: Number(l.quantity),
              unit_price: String(l.unit_price),
              rate_pct: Number(l.rate_pct),
              product_id: (l.product_id as string | null) ?? null,
            })),
            { description: 'Portes especiales', quantity: 1, unit_price: '15.00', rate_pct: 21 },
          ],
        },
      });
      check('a line can be ADDED to the document', withExtra.status === 200,
        { status: withExtra.status, error: withExtra.body.error });

      const after = await prisma.invoice.findUnique({
        where: { id: id2 }, select: { lines: true, total: true, manually_edited: true },
      });
      const lines = (after?.lines ?? []) as unknown as Array<Record<string, unknown>>;
      check('...and it is on the document', lines.length === existing.length + 1
        && lines[lines.length - 1]?.description === 'Portes especiales',
        lines.map((l) => l.description));
      check('...with the totals recomputed by the server, not sent by the client',
        Math.round(Number(after?.total) * 100)
          === Math.round(Number(before?.total) * 100) + Math.round(15 * 100),
        { before: before?.total, after: after?.total });
      check('...and the draft now says it no longer follows its order',
        after?.manually_edited === true);

      const emptied = await call(`/api/admin/invoices/${id2}`, {
        method: 'PUT', token, body: { lines: [] },
      });
      check('a document cannot be emptied of every line', emptied.status === 422,
        { status: emptied.status, error: emptied.body.error });
    }

    // ─── 7. The structural refusals still refuse ────────────
    const cancelled = await call('/api/admin/orders', {
      method: 'POST', token,
      body: {
        user_id: user.id, address_id: address.id, delivery_fee: 0,
        items: [{ variant_id: variant.id, quantity: 1 }],
      },
    });
    const cancelledId = cancelled.body.data?.order?.id as string | undefined;
    if (cancelledId) {
      orderIds.push(cancelledId);
      await prisma.order.update({ where: { id: cancelledId }, data: { status: 'cancelled' } });
      const refused = await call(`/api/admin/orders/${cancelledId}/invoice`, {
        method: 'POST', token, body: { kind: 'invoice' },
      });
      check('a CANCELLED order is still refused outright', refused.status === 422,
        { status: refused.status, error: refused.body.error });
    }

    const stockDraft = await call('/api/admin/orders', {
      method: 'POST', token,
      body: {
        user_id: user.id, address_id: address.id, delivery_fee: 0, status: 'draft',
        items: [{ variant_id: variant.id, quantity: 1 }],
      },
    });
    const stockDraftId = stockDraft.body.data?.order?.id as string | undefined;
    if (stockDraftId) {
      orderIds.push(stockDraftId);
      const refused = await call(`/api/admin/orders/${stockDraftId}/invoice`, {
        method: 'POST', token, body: { kind: 'invoice' },
      });
      check('an order still holding no stock is refused a FACTURA', refused.status === 422,
        { status: refused.status, error: refused.body.error });
      const quoted = await call(`/api/admin/orders/${stockDraftId}/invoice`, {
        method: 'POST', token, body: { kind: 'albaran' },
      });
      check('...but can still be quoted with an albarán',
        quoted.status === 201 || quoted.status === 200,
        { status: quoted.status, error: quoted.body.error });
      const quotedId = quoted.body.data?.invoice?.id as string | undefined;
      if (quotedId) invoiceIds.push(quotedId);
    }

    // ─── 8. A factura is one per sale, still ────────────────
    const again = await call(`/api/admin/orders/${orderId}/invoice`, {
      method: 'POST', token, body: { kind: 'invoice' },
    });
    check('a second factura for the same order is still refused', again.status === 422,
      { status: again.status, error: again.body.error });

  } finally {
    if (invoiceIds.length) {
      // The triggers that make an issued document immutable also stop the
      // cleanup. Disabling them for the delete is the only way out, and is
      // exactly what the invoicing suite does.
      await prisma.$executeRawUnsafe('ALTER TABLE invoices DISABLE TRIGGER invoices_no_mutate_issued');
      await prisma.$executeRawUnsafe('ALTER TABLE invoices DISABLE TRIGGER invoices_no_delete_issued');
      try {
        await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
      } finally {
        await prisma.$executeRawUnsafe('ALTER TABLE invoices ENABLE TRIGGER invoices_no_mutate_issued');
        await prisma.$executeRawUnsafe('ALTER TABLE invoices ENABLE TRIGGER invoices_no_delete_issued');
      }
    }
    if (orderIds.length) {
      await prisma.orderEditLog.deleteMany({ where: { order_id: { in: orderIds } } });
      await prisma.orderItem.deleteMany({ where: { order_id: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    if (productIds.length) {
      await prisma.productVariant.deleteMany({ where: { product_id: { in: productIds } } });
      await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    }
    if (categoryId) await prisma.category.deleteMany({ where: { id: categoryId } });
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
