// ─── Integration test · the document archive ───────────────────────────────
//
// Run:  cd packages/api && npm run test:documents
//
// Lawyers read this, so what must hold is what is and is not in it:
//
//   · ONLY ISSUED DOCUMENTS, each under its own tab. A draft is nobody's document.
//   · DATES ARE MADRID'S. "1 April" starts at 22:00 UTC on 31 March in summer, and
//     a factura issued just then has to land in April, on screen and in the ZIP.
//   · A BILL HAS NO RECORD, so that tab lists sales: one row per purchase however
//     it was split, without drafts or cancelled orders.
//   · ADMIN ONLY, AND A LAWYER REACHES NOTHING ELSE. That gate is deny by default,
//     so it is checked against routes that have no role check of their own.
//   · THE EXACT PDF: kept once, never replaced, handed back byte for byte, and
//     refused if the stored file has been altered. Written to local disk here,
//     never to the real storage, whatever .env says.
//
// Goes through the real routes over HTTP. Makes its own fixtures, removes them.

import crypto from 'crypto';
import fs from 'fs/promises';
import http from 'http';
import path from 'path';
import { Prisma } from '@prisma/client';
import app from '../../server';
import prisma from '../../lib/prisma';
import { generateAccessToken, generateAdminAccessToken } from '../../lib/jwt';
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
  // bunnyConfig() reads the environment on each call, so this holds for the whole
  // run even though .env has already loaded: these files go to disk.
  process.env.BUNNY_STORAGE_ZONE = '';

  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  const userIds: string[] = [];
  const orderIds: string[] = [];
  const parentIds: string[] = [];
  const invoiceIds: string[] = [];
  const adminIds: string[] = [];
  const repUserIds: string[] = [];
  let addressId: string | null = null;

  try {
    const admin = await prisma.admin.findFirst({ select: { id: true, email: true, role: true, name: true } });
    if (!admin) { console.log('  SKIP  no admin row to act as'); return; }
    const token = generateAdminAccessToken({ adminId: admin.id, email: admin.email, role: admin.role });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const call = async (path: string, as: string | null = token): Promise<{ status: number; body: any }> => {
      const res = await fetch(`${base}${path}`, { headers: as ? { Authorization: `Bearer ${as}` } : {} });
      return { status: res.status, body: await res.json() };
    };

    // ─── Fixtures ────────────────────────────────────────────
    const client = await prisma.user.create({
      data: {
        name: `QA Archivo ${stamp}`, email: `qa.docs.${stamp}@cesto.test`,
        phone: `+346${String(Math.floor(Math.random() * 90000000) + 10000000)}`, tax_id: `B${stamp}`,
      },
      select: { id: true, email: true },
    });
    userIds.push(client.id);
    const address = await prisma.address.create({
      data: {
        user_id: client.id, contact_name: 'QA', contact_phone: '600000000',
        street_line_1: 'C/ Prueba 1', postcode: '28013', city: 'Madrid', province: 'Madrid',
      },
      select: { id: true },
    });
    addressId = address.id;

    const mkOrder = async (status: 'pending' | 'cancelled' | 'draft' | 'delivered', createdAt: string, parentId?: string) => {
      const o = await prisma.order.create({
        data: {
          order_number: generateOrderNumber(), user_id: client.id, address_id: address.id, address_snapshot: {},
          payment_method: 'cod', status, subtotal: new Prisma.Decimal('10.00'), delivery_fee: new Prisma.Decimal(0),
          total: new Prisma.Decimal('10.00'), created_at: new Date(createdAt), parent_order_id: parentId ?? null,
        },
        select: { id: true, order_number: true },
      });
      orderIds.push(o.id);
      return o;
    };

    let seq = 0;
    const mkDoc = async (
      kind: 'invoice' | 'albaran' | 'credit_note', status: 'issued' | 'draft', orderId: string, issuedAt: string | null,
      extra: Partial<Prisma.InvoiceUncheckedCreateInput> = {},
    ) => {
      seq += 1;
      const number = `QD${kind[0].toUpperCase()}-${stamp}-${seq}`;
      const row = await prisma.invoice.create({
        data: {
          kind, status, order_id: orderId, user_id: client.id,
          ...(status === 'issued'
            ? { series: `Q${kind[0].toUpperCase()}`, year: 2098, number: Number(`${stamp}${seq}`), invoice_number: number, issue_date: new Date(issuedAt!) }
            : {}),
          seller_snapshot: {}, buyer_snapshot: { name: `Comprador ${stamp}`, tax_id: `F${stamp}` }, lines: [], totals: {},
          hidden_lines: [{ description: 'never on paper' }],
          taxable_base: new Prisma.Decimal('8.26'), vat_total: new Prisma.Decimal('1.74'), total: new Prisma.Decimal('10.00'),
          ...extra,
        },
        select: { id: true, invoice_number: true },
      });
      invoiceIds.push(row.id);
      return row;
    };

    const o1 = await mkOrder('delivered', '2026-03-20T10:00:00Z');
    const o2 = await mkOrder('delivered', '2026-03-25T10:00:00Z');
    const o3 = await mkOrder('pending', '2026-04-10T10:00:00Z');
    const lastOfMarch = await mkDoc('invoice', 'issued', o1.id, '2026-03-31T21:59:00Z', { issued_by_admin_id: admin.id });
    const firstOfApril = await mkDoc('invoice', 'issued', o2.id, '2026-03-31T22:01:00Z');
    const draftFactura = await mkDoc('invoice', 'draft', o3.id, null);
    const credit = await mkDoc('credit_note', 'issued', o2.id, '2026-05-02T10:00:00Z');
    const albaran = await mkDoc('albaran', 'issued', o1.id, '2026-03-21T10:00:00Z');

    const list = async (query: string) => {
      const r = await call(`/api/admin/documents?q=${stamp}&limit=100&${query}`);
      return { status: r.status, ids: (r.body.data?.items ?? []).map((i: { id: string }) => i.id) as string[], body: r.body };
    };

    // ─── 1. Who gets in ──────────────────────────────────────
    const noToken = await call('/api/admin/documents?kind=invoice', null);
    check('no token is refused', noToken.status === 401, noToken.status);
    const customer = generateAccessToken({ userId: client.id, email: client.email ?? undefined });
    const asCustomer = await call('/api/admin/documents?kind=invoice', customer);
    check('a customer is refused', asCustomer.status === 401 || asCustomer.status === 403, asCustomer.status);

    // ─── 2. Each tab holds its own, issued only ──────────────
    const facturas = await list('kind=invoice');
    check('facturas lists the issued ones', facturas.ids.includes(lastOfMarch.id) && facturas.ids.includes(firstOfApril.id), facturas.ids);
    check('...and a credit note with them', facturas.ids.includes(credit.id), facturas.ids);
    check('...never a draft', !facturas.ids.includes(draftFactura.id), facturas.ids);
    check('...nor an albarán', !facturas.ids.includes(albaran.id), facturas.ids);
    const albaranes = await list('kind=albaran');
    check('albaranes lists only albaranes', albaranes.ids.length === 1 && albaranes.ids[0] === albaran.id, albaranes.ids);

    const row = facturas.body.data.items.find((i: { id: string }) => i.id === lastOfMarch.id);
    check('a row names the client as the document prints them',
      row?.client?.name === `Comprador ${stamp}` && row?.client?.tax_id === `F${stamp}`, row?.client);
    check('...and its order', row?.order?.order_number === o1.order_number, row?.order);

    // ─── 3. Madrid's days, both ends inclusive ───────────────
    const march = await list('kind=invoice&from=2026-03-01&to=2026-03-31');
    check("23:59 in Madrid on 31 March is March's", march.ids.includes(lastOfMarch.id), march.ids);
    check("00:01 in Madrid on 1 April is not, though it is 31 March in UTC", !march.ids.includes(firstOfApril.id), march.ids);
    const april = await list('kind=invoice&from=2026-04-01&to=2026-04-30');
    check("...it is April's", april.ids.length === 1 && april.ids[0] === firstOfApril.id, april.ids);
    const oneDay = await list('kind=invoice&from=2026-05-02&to=2026-05-02');
    check('one day is a whole day', oneDay.ids.length === 1 && oneDay.ids[0] === credit.id, oneDay.ids);
    const badDay = await list('kind=invoice&from=2026-02-31');
    check('a date that does not exist is refused', badDay.status === 400, badDay.status);
    const badKind = await call('/api/admin/documents?kind=proforma');
    check('so is a kind that does not', badKind.status === 400, badKind.status);

    // ─── 4. Sorting ──────────────────────────────────────────
    const newest = await list('kind=invoice');
    check('newest first by default', newest.ids[0] === credit.id && newest.ids[newest.ids.length - 1] === lastOfMarch.id, newest.ids);
    const oldest = await list('kind=invoice&sort=asc');
    check('oldest first when asked', oldest.ids[0] === lastOfMarch.id && oldest.ids[oldest.ids.length - 1] === credit.id, oldest.ids);

    // ─── 5. Searching ────────────────────────────────────────
    const byNumber = await call(`/api/admin/documents?kind=invoice&q=${lastOfMarch.invoice_number}`);
    check('finds by number', byNumber.body.data.items.length === 1, byNumber.body.data.items.length);
    const byOrder = await call(`/api/admin/documents?kind=invoice&q=${o2.order_number}`);
    check('finds by order', byOrder.body.data.items.some((i: { id: string }) => i.id === firstOfApril.id), byOrder.body.data.items.length);
    const byTaxId = await call(`/api/admin/documents?kind=invoice&q=B${stamp}`);
    check("finds by the client's CIF", byTaxId.body.data.total === 3, byTaxId.body.data.total);

    // ─── 6. One document ─────────────────────────────────────
    const one = await call(`/api/admin/documents/issued/${lastOfMarch.id}`);
    check('reads an issued document', one.status === 200 && one.body.data.invoice.invoice_number === lastOfMarch.invoice_number, one.status);
    check('...saying who issued it', one.body.data.issued_by?.name === admin.name && one.body.data.issued_by?.is_rep === false, one.body.data.issued_by);
    check('...its client', one.body.data.client?.id === client.id, one.body.data.client);
    check('...and its order', one.body.data.order?.id === o1.id && one.body.data.order?.status === 'delivered', one.body.data.order);
    check('...without the lines left off its paper', one.body.data.invoice.hidden_lines === undefined);
    const readDraft = await call(`/api/admin/documents/issued/${draftFactura.id}`);
    check('a draft is not in the archive', readDraft.status === 404, readDraft.status);
    const badId = await call('/api/admin/documents/issued/not-a-uuid');
    check('nor is nonsense', badId.status === 404, badId.status);

    // ─── 7. The ZIP's pages ──────────────────────────────────
    const exp = await call(`/api/admin/documents/export?kind=invoice&q=${stamp}&from=2026-03-01&to=2026-04-30&limit=1`);
    check('export honours the range', exp.body.data.total === 2, exp.body.data.total);
    check('...one page at a time', exp.body.data.items.length === 1 && exp.body.data.totalPages === 2, exp.body.data.totalPages);
    check('...oldest first, whatever the screen shows', exp.body.data.items[0].id === lastOfMarch.id, exp.body.data.items[0]?.id);
    const printed = exp.body.data.items[0].invoice;
    check('...with what a PDF needs', !!printed.lines && !!printed.seller_snapshot && !!printed.totals && printed.order?.order_number === o1.order_number);
    check('...and without the hidden lines', printed.hidden_lines === undefined);
    const page2 = await call(`/api/admin/documents/export?kind=invoice&q=${stamp}&from=2026-03-01&to=2026-04-30&limit=1&page=2`);
    check('...and the next page is the next document', page2.body.data.items[0].id === firstOfApril.id, page2.body.data.items[0]?.id);

    // ─── 8. Bills: sales, not records ────────────────────────
    const parent = await prisma.parentOrder.create({
      data: {
        order_number: generateParentOrderNumber(), user_id: client.id, address_id: address.id, payment_method: 'cod',
        address_snapshot: {}, subtotal: new Prisma.Decimal('20.00'), delivery_fee_total: new Prisma.Decimal(0),
        total: new Prisma.Decimal('20.00'), created_at: new Date('2026-06-15T10:00:00Z'),
      },
      select: { id: true, order_number: true },
    });
    parentIds.push(parent.id);
    await mkOrder('pending', '2026-06-15T10:00:00Z', parent.id);
    await mkOrder('pending', '2026-06-15T10:00:00Z', parent.id);
    const cancelled = await mkOrder('cancelled', '2026-06-16T10:00:00Z');
    const parked = await mkOrder('draft', '2026-06-17T10:00:00Z');
    const lastBill = await mkOrder('delivered', '2026-06-30T21:59:00Z');
    const nextMonth = await mkOrder('delivered', '2026-06-30T22:01:00Z');

    const bills = await list('kind=bill&from=2026-06-01&to=2026-07-31');
    check('a split purchase is one bill', bills.ids.filter((i) => i === parent.id).length === 1
      && bills.ids.length === 3, bills.ids);
    check('a cancelled order has none', !bills.ids.includes(cancelled.id), bills.ids);
    check('nor a parked draft', !bills.ids.includes(parked.id), bills.ids);
    const billRow = bills.body.data.items.find((i: { id: string }) => i.id === parent.id);
    check("a bill's row carries its order's number and status",
      billRow?.number === parent.order_number && billRow?.order?.status === 'pending' && billRow?.kind === 'bill', billRow);
    const june = await list('kind=bill&from=2026-06-01&to=2026-06-30');
    check("a bill's date is Madrid's too", june.ids.includes(lastBill.id) && !june.ids.includes(nextMonth.id), june.ids);
    const billsAsc = await list('kind=bill&from=2026-06-01&to=2026-07-31&sort=asc');
    check('bills sort both ways', billsAsc.ids[0] === parent.id && bills.ids[0] === nextMonth.id, { asc: billsAsc.ids, desc: bills.ids });

    const readBill = await call(`/api/admin/documents/bill/${parent.id}`);
    check('reads a whole purchase as one bill', readBill.status === 200 && readBill.body.data.bill.order_number === parent.order_number
      && readBill.body.data.order.is_purchase === true, readBill.status);
    const readSolo = await call(`/api/admin/documents/bill/${lastBill.id}`);
    check('...and a single order', readSolo.status === 200 && readSolo.body.data.order.id === lastBill.id
      && readSolo.body.data.client.id === client.id, readSolo.status);
    const billExport = await call(`/api/admin/documents/export?kind=bill&q=${stamp}&from=2026-06-01&to=2026-07-31`);
    check('export carries the bills themselves',
      billExport.body.data.total === 3 && billExport.body.data.items.every((i: { bill?: { lines?: unknown } }) => !!i.bill?.lines), billExport.body.data.total);
    const noBill = await call('/api/admin/documents/bill/00000000-0000-4000-8000-000000000000');
    check('a bill for nothing is a 404', noBill.status === 404, noBill.status);

    // ─── 9. The exact PDF ────────────────────────────────────
    const sendPdf = async (url: string, bytes: Buffer, as: string = token) => {
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }), 'x.pdf');
      const res = await fetch(`${base}${url}`, { method: 'POST', headers: { Authorization: `Bearer ${as}` }, body: form });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { status: res.status, body: await res.json() as any };
    };
    const readPdf = async (id: string, as: string = token) => {
      const res = await fetch(`${base}/api/admin/documents/issued/${id}/pdf`, { headers: { Authorization: `Bearer ${as}` } });
      return { status: res.status, type: res.headers.get('content-type'), bytes: Buffer.from(await res.arrayBuffer()) };
    };
    const first = Buffer.from(`%PDF-1.3 first file ${stamp}`);
    const second = Buffer.from(`%PDF-1.3 a different file ${stamp}`);
    const fingerprint = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');

    const before = await readPdf(lastOfMarch.id);
    check('no saved PDF yet is a 404', before.status === 404, before.status);
    const flagged = await call(`/api/admin/documents/issued/${lastOfMarch.id}`);
    check('...and its details say none', flagged.body.data.pdf === null, flagged.body.data.pdf);

    const notPdf = await sendPdf(`/api/admin/documents/issued/${lastOfMarch.id}/pdf`, Buffer.from('<html>not one</html>'));
    check('something that is not a PDF is refused', notPdf.status === 400, notPdf.status);
    const onDraft = await sendPdf(`/api/admin/documents/issued/${draftFactura.id}/pdf`, first);
    check('a draft cannot have a PDF kept', onDraft.status === 404, onDraft.status);

    const saved = await sendPdf(`/api/admin/documents/issued/${lastOfMarch.id}/pdf`, first);
    check('an issued document keeps its PDF', saved.status === 201 && saved.body.data.status === 'saved', saved.body);
    check('...with its fingerprint', saved.body.data.sha256 === fingerprint(first), saved.body.data.sha256);
    const back = await readPdf(lastOfMarch.id);
    check('...and hands back those exact bytes', back.status === 200 && back.bytes.equals(first), back.status);
    check('...as a PDF', back.type === 'application/pdf', back.type);

    const again = await sendPdf(`/api/admin/documents/issued/${lastOfMarch.id}/pdf`, second);
    check('a second file changes nothing', again.status === 200 && again.body.data.status === 'already', again.body);
    check('...the first is still the one kept', (await readPdf(lastOfMarch.id)).bytes.equals(first));

    const told = await call(`/api/admin/documents/issued/${lastOfMarch.id}`);
    check('its details say so, and who', told.body.data.pdf?.sha256 === fingerprint(first)
      && told.body.data.pdf?.size_bytes === first.length && told.body.data.pdf?.saved_by?.name === admin.name, told.body.data.pdf);
    check('...but never where it is stored', !JSON.stringify(told.body).includes('documents/') && told.body.data.pdf?.storage_key === undefined);
    const inExport = await call(`/api/admin/documents/export?kind=invoice&q=${stamp}&limit=50`);
    const flags = Object.fromEntries(inExport.body.data.items.map((i: { id: string; pdf_saved: boolean }) => [i.id, i.pdf_saved]));
    check('export says which have a file', flags[lastOfMarch.id] === true && flags[firstOfApril.id] === false, flags);

    // Someone edits the stored file behind our back.
    const stored = await prisma.invoicePdf.findUniqueOrThrow({ where: { invoice_id: lastOfMarch.id } });
    const onDisk = path.join(process.cwd(), 'private-documents', stored.storage_key);
    await fs.writeFile(onDisk, second);
    const altered = await readPdf(lastOfMarch.id);
    check('a file altered in storage is not served', altered.status === 409, altered.status);
    await fs.writeFile(onDisk, first);
    check('...and is again once it matches', (await readPdf(lastOfMarch.id)).status === 200);

    // ─── 10. A rep keeps the PDF of their own albarán, and no other ──
    const repUser = await prisma.user.create({
      data: { name: `QA Rep Docs ${stamp}`, email: `qa.docs.rep.${stamp}@cesto.test`, phone: `+346${String(Math.floor(Math.random() * 90000000) + 10000000)}` },
      select: { id: true, email: true },
    });
    userIds.push(repUser.id);
    repUserIds.push(repUser.id);
    await prisma.salesRep.create({ data: { user_id: repUser.id, code: `QA-D-${stamp}` } });
    const repToken = generateAccessToken({ userId: repUser.id, email: repUser.email ?? undefined });
    const repOrder = await prisma.order.create({
      data: {
        order_number: generateOrderNumber(), user_id: client.id, address_id: address.id, address_snapshot: {}, payment_method: 'cod',
        status: 'pending', subtotal: new Prisma.Decimal('10'), delivery_fee: new Prisma.Decimal(0), total: new Prisma.Decimal('10'),
        created_by_sales_rep_id: repUser.id,
      },
      select: { id: true },
    });
    orderIds.push(repOrder.id);
    const repAlbaran = await mkDoc('albaran', 'issued', repOrder.id, '2026-08-01T10:00:00Z');
    const repDraft = await mkDoc('albaran', 'draft', repOrder.id, null);
    const repFactura = await mkDoc('invoice', 'issued', repOrder.id, '2026-08-02T10:00:00Z');

    const repSaved = await sendPdf(`/api/sales/invoices/${repAlbaran.id}/pdf`, first, repToken);
    check('a rep keeps the PDF of their own albarán', repSaved.status === 201, repSaved.body);
    const repRow = await prisma.invoicePdf.findUnique({ where: { invoice_id: repAlbaran.id } });
    check('...recorded as theirs', repRow?.saved_by_sales_rep_id === repUser.id && repRow?.saved_by_admin_id === null, repRow);
    check('...and is told nothing about where', repSaved.body.data.sha256 === undefined && !JSON.stringify(repSaved.body).includes('documents/'), repSaved.body);
    const repDraftTry = await sendPdf(`/api/sales/invoices/${repDraft.id}/pdf`, first, repToken);
    check('not for a draft', repDraftTry.status === 409, repDraftTry.status);
    const repFacturaTry = await sendPdf(`/api/sales/invoices/${repFactura.id}/pdf`, first, repToken);
    check('not for a factura, which to them does not exist', repFacturaTry.status === 404, repFacturaTry.status);
    const repOther = await sendPdf(`/api/sales/invoices/${firstOfApril.id}/pdf`, first, repToken);
    check("not for somebody else's document", repOther.status === 404, repOther.status);

    // ─── 11. A lawyer: created under Staff, the archive and nothing else ──
    const superAdmin = await prisma.admin.findFirst({ where: { role: 'super_admin', is_active: true }, select: { id: true, email: true } });
    if (!superAdmin) { console.log('  SKIP  no super admin to create a lawyer with'); return; }
    const superToken = generateAdminAccessToken({ adminId: superAdmin.id, email: superAdmin.email, role: 'super_admin' });
    const createLawyer = await fetch(`${base}/api/admin/staff`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${superToken}` },
      body: JSON.stringify({ name: `QA Lawyer ${stamp}`, email: `qa.lawyer.${stamp}@cesto.test`, role: 'lawyer' }),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const created = await createLawyer.json() as any;
    check('a super admin creates a lawyer under Staff', createLawyer.status === 201 && created.data?.admin?.role === 'lawyer', created);
    const lawyerRow = await prisma.admin.findUnique({ where: { email: `qa.lawyer.${stamp}@cesto.test` }, select: { id: true, role: true } });
    if (lawyerRow) adminIds.push(lawyerRow.id);
    const tempPassword: string | undefined = created.data?.temp_password;
    const signIn = await fetch(`${base}/api/admin/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `qa.lawyer.${stamp}@cesto.test`, password: tempPassword }),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const signedIn = await signIn.json() as any;
    check('...who can sign in with the password it gives', signIn.status === 200 && signedIn.data?.admin?.role === 'lawyer', { status: signIn.status, keys: Object.keys(created.data ?? {}) });
    // A temporary password is replaced first: until then the archive is closed too.
    const held = await call('/api/admin/documents?kind=invoice', signedIn.data?.accessToken);
    check('...but must choose their own password first', held.status === 403, held.status);
    const ownPassword = `Abogado${stamp}Ok`;
    const changedRes = await fetch(`${base}/api/admin/auth/change-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${signedIn.data?.accessToken}` },
      body: JSON.stringify({ currentPassword: tempPassword, newPassword: ownPassword }),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const changedBody = await changedRes.json() as any;
    check('...which they can', changedRes.status === 200, changedBody);
    const lawyerToken: string = changedBody.data?.accessToken;

    const me = await call('/api/admin/auth/me', lawyerToken);
    check('a lawyer knows who they are', me.status === 200, me.status);
    for (const allowed of [
      '/api/admin/documents?kind=invoice', '/api/admin/documents?kind=albaran', '/api/admin/documents?kind=bill',
      `/api/admin/documents/issued/${lastOfMarch.id}`, `/api/admin/documents/bill/${lastBill.id}`,
      `/api/admin/documents/export?kind=invoice&q=${stamp}`,
    ]) {
      const r = await call(allowed, lawyerToken);
      check(`a lawyer reads ${allowed.split('?')[0].replace(/[0-9a-f-]{36}/, ':id')}`, r.status === 200, r.status);
    }
    const lawyerFile = await readPdf(lastOfMarch.id, lawyerToken);
    check('...and the saved file', lawyerFile.status === 200 && lawyerFile.bytes.equals(first), lawyerFile.status);

    for (const refused of [
      '/api/admin/orders', `/api/admin/orders/${o1.id}`, '/api/admin/users', `/api/admin/users/${client.id}`, '/api/admin/products',
      '/api/admin/invoices', `/api/admin/invoices/${lastOfMarch.id}`, '/api/admin/staff', '/api/admin/dashboard/stats', '/api/admin/settings',
      '/api/admin/notifications', '/api/admin/invoicing-settings', '/api/admin/documentsX', '/api/admin/sales-reps',
    ]) {
      const r = await call(refused, lawyerToken);
      check(`a lawyer is refused ${refused.replace(/[0-9a-f-]{36}/, ':id')}`, r.status === 403, r.status);
    }
    const lawyerWrite = await fetch(`${base}/api/admin/invoices/${lastOfMarch.id}/issue`, { method: 'POST', headers: { Authorization: `Bearer ${lawyerToken}` } });
    check('a lawyer cannot issue anything', lawyerWrite.status === 403, lawyerWrite.status);
    const ownerAgain = await call('/api/admin/orders', superToken);
    check('other staff are untouched by the gate', ownerAgain.status === 200, ownerAgain.status);
    const opsToken = generateAdminAccessToken({ adminId: superAdmin.id, email: superAdmin.email, role: 'ops' });
    check('...ops too', (await call('/api/admin/orders', opsToken)).status === 200);
    check('...and they read the archive', (await call('/api/admin/documents?kind=invoice', opsToken)).status === 200);
    const catalogToken = generateAdminAccessToken({ adminId: superAdmin.id, email: superAdmin.email, role: 'catalog' });
    check('...as does catalog, like every other invoice route', (await call('/api/admin/documents?kind=invoice', catalogToken)).status === 200);

    // Managed from Staff, like anyone there.
    const staffAction = (url: string, method: string, body?: unknown) => fetch(`${base}${url}`, {
      method,
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${superToken}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const tryLogin = (password: string | undefined) => fetch(`${base}/api/admin/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `qa.lawyer.${stamp}@cesto.test`, password }),
    });
    const reset = await staffAction(`/api/admin/staff/${lawyerRow!.id}/reset-password`, 'POST');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resetBody = await reset.json() as any;
    const newPassword: string | undefined = resetBody.data?.temp_password;
    check('Staff can reset their password', reset.status === 200 && !!newPassword, resetBody);
    check('...the old one stops working', (await tryLogin(ownPassword)).status === 401);
    check('...the new one works', (await tryLogin(newPassword)).status === 200);
    const disable = await staffAction(`/api/admin/staff/${lawyerRow!.id}`, 'PUT', { is_active: false });
    check('Staff can disable them', disable.status === 200, disable.status);
    check('...and they can no longer sign in', (await tryLogin(newPassword)).status !== 200);
    const ownerStaff = await call('/api/admin/staff?role=lawyer', superToken);
    check('Staff can list lawyers', ownerStaff.status === 200 && ownerStaff.body.data.items.some((s: { id: string }) => s.id === lawyerRow!.id), ownerStaff.status);
    check('a lawyer cannot manage Staff', (await call('/api/admin/staff', lawyerToken)).status === 403);
  } finally {
    // The files this run wrote, read before their rows go.
    const files = await prisma.invoicePdf.findMany({ where: { invoice_id: { in: invoiceIds } }, select: { storage_key: true } });
    await Promise.all(files.map((f) => fs.rm(path.join(process.cwd(), 'private-documents', f.storage_key), { force: true })));
    if (adminIds.length) await prisma.admin.deleteMany({ where: { id: { in: adminIds } } });
    if (repUserIds.length) await prisma.salesRep.deleteMany({ where: { user_id: { in: repUserIds } } });
    await prisma.$executeRawUnsafe('ALTER TABLE invoices DISABLE TRIGGER invoices_no_mutate_issued');
    await prisma.$executeRawUnsafe('ALTER TABLE invoices DISABLE TRIGGER invoices_no_delete_issued');
    try {
      if (invoiceIds.length) await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
    } finally {
      await prisma.$executeRawUnsafe('ALTER TABLE invoices ENABLE TRIGGER invoices_no_mutate_issued');
      await prisma.$executeRawUnsafe('ALTER TABLE invoices ENABLE TRIGGER invoices_no_delete_issued');
    }
    if (orderIds.length) await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    if (parentIds.length) await prisma.parentOrder.deleteMany({ where: { id: { in: parentIds } } });
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
