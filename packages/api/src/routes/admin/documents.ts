import { Router } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { success, error } from '../../lib/response';
import { asyncHandler } from '../../lib/async';
import { parsePage, paged, type PageParams } from '../../lib/pagination';
import { billFor } from '../../lib/bill';
import { listGroupedOrders } from '../../lib/orderGroupList';
import { deriveParentOrderStatus } from '../../lib/parentOrder';
import { madridDayStart } from '../../lib/repEarnings';
import { addDays } from '../../lib/homeGroceryPlan';
import { pdfUpload, readInvoicePdf, saveInvoicePdf } from '../../lib/invoicePdf';

/**
 * The document archive (2026-11-07): where the lawyers find every factura,
 * albarán and bill, read one, or take a date range away as a ZIP.
 *
 * An issued factura or albarán is a permanent record: its parties, lines and
 * totals are frozen on the row, and database triggers refuse to change or delete
 * it. Its exact PDF is kept beside it (lib/invoicePdf), so what is read here is the
 * file as it was first made. Drafts stay out, because a draft is nobody's document.
 *
 * A BILL IS NOT STORED ANYWHERE (lib/bill): it is built from the order as it
 * stands, and has no number or issue date. So that tab lists the sales a bill
 * can be made for, by order date. A parked draft has not been sold yet and a
 * cancelled order was not sold at all, so neither is listed.
 *
 * Dates are Madrid's calendar days, inclusive at both ends: what "1 to 30 April"
 * means to whoever asked for it. Read-only throughout.
 */
const router = Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

type ArchiveKind = 'invoice' | 'albaran' | 'bill';
type Sort = 'asc' | 'desc';

interface Filters {
  kind: ArchiveKind;
  q?: string;
  /** Inclusive. */
  start?: Date;
  /** Exclusive: the start of the day after the last one asked for. */
  endBefore?: Date;
}

/** A real calendar day: `2026-02-31` parses, and rolls over to March. */
const isDay = (v: string) => DAY.test(v)
  && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))
  && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

/** The query's filters, or what is wrong with them. */
function readFilters(query: Record<string, unknown>): Filters | string {
  const { kind, from, to, q } = query as Record<string, string | undefined>;
  if (kind !== 'invoice' && kind !== 'albaran' && kind !== 'bill') return 'kind must be invoice, albaran or bill.';
  if (from && !isDay(from)) return 'from must be a date, YYYY-MM-DD.';
  if (to && !isDay(to)) return 'to must be a date, YYYY-MM-DD.';
  return {
    kind,
    q: q?.trim() || undefined,
    start: from ? madridDayStart(from) : undefined,
    endBefore: to ? madridDayStart(addDays(to, 1)) : undefined,
  };
}

const issuedWhere = (f: Filters): Prisma.InvoiceWhereInput => ({
  status: 'issued',
  // A credit note corrects a factura, so it is filed with them.
  kind: f.kind === 'invoice' ? { in: ['invoice', 'credit_note'] } : 'albaran',
  ...(f.start || f.endBefore ? { issue_date: { gte: f.start, lt: f.endBefore } } : {}),
  ...(f.q ? {
    OR: [
      { invoice_number: { contains: f.q, mode: 'insensitive' as const } },
      { order: { order_number: { contains: f.q, mode: 'insensitive' as const } } },
      { parent_order: { order_number: { contains: f.q, mode: 'insensitive' as const } } },
      { user: { name: { contains: f.q, mode: 'insensitive' as const } } },
      { user: { tax_id: { contains: f.q, mode: 'insensitive' as const } } },
      { user: { email: { contains: f.q, mode: 'insensitive' as const } } },
    ],
  } : {}),
});

/** The sales a bill can be made for: one row per purchase, however it was split. */
const billPage = (f: Filters, params: PageParams, sort: Sort) => listGroupedOrders(
  {
    q: f.q,
    from: f.start?.toISOString(),
    // The list's upper bound is inclusive.
    to: f.endBefore ? new Date(f.endBefore.getTime() - 1).toISOString() : undefined,
    sort,
  },
  params,
  [Prisma.sql`o.status::text NOT IN ('cancelled', 'draft')`],
);

const text = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v : null);

// ─── GET /api/admin/documents ───────────────────────────
router.get('/', asyncHandler(async (req, res) => {
  const filters = readFilters(req.query);
  if (typeof filters === 'string') return error(res, filters, 400);
  const params = parsePage(req.query, 25, 100);
  const sort: Sort = req.query.sort === 'asc' ? 'asc' : 'desc';

  if (filters.kind === 'bill') {
    const page = await billPage(filters, params, sort);
    return success(res, {
      ...page,
      items: page.items.map((g) => ({
        id: g.id,
        kind: 'bill' as const,
        number: g.order_number,
        date: g.created_at,
        total: g.total,
        client: g.user ? { id: g.user.id, name: g.user.name, tax_id: null } : null,
        order: { id: g.id, order_number: g.order_number, status: g.status },
      })),
    });
  }

  const where = issuedWhere(filters);
  const [rows, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      orderBy: [{ issue_date: sort }, { id: sort }],
      skip: params.skip,
      take: params.limit,
      select: {
        id: true, kind: true, invoice_number: true, issue_date: true, total: true,
        buyer_snapshot: true,
        user: { select: { id: true, name: true, tax_id: true } },
        order: { select: { id: true, order_number: true, status: true } },
        parent_order: { select: { id: true, order_number: true } },
      },
    }),
    prisma.invoice.count({ where }),
  ]);

  return success(res, paged(rows.map((r) => {
    // The name and CIF the document itself prints: someone reading the list
    // will match it against the paper, and a customer's profile can change.
    const buyer = (r.buyer_snapshot ?? {}) as Record<string, unknown>;
    return {
      id: r.id,
      kind: r.kind,
      number: r.invoice_number ?? '',
      date: r.issue_date,
      total: r.total,
      client: {
        id: r.user.id,
        name: text(buyer.name) ?? r.user.name,
        tax_id: text(buyer.tax_id) ?? r.user.tax_id,
      },
      order: r.order
        ? { id: r.order.id, order_number: r.order.order_number, status: r.order.status }
        : r.parent_order
          ? { id: r.parent_order.id, order_number: r.parent_order.order_number, status: null }
          : null,
    };
  }), total, params));
}));

// ─── GET /api/admin/documents/export ────────────────────
//
// One page of a date range with everything a PDF needs, for the ZIP the browser
// builds. Oldest first whatever the screen is sorted by, so something issued
// while a long download runs lands at the end rather than shifting the pages.
router.get('/export', asyncHandler(async (req, res) => {
  const filters = readFilters(req.query);
  if (typeof filters === 'string') return error(res, filters, 400);
  const params = parsePage(req.query, 20, 50);

  if (filters.kind === 'bill') {
    const page = await billPage(filters, params, 'asc');
    const bills = await Promise.all(page.items.map(async (g) => ({ id: g.id, bill: await billFor(g.id) })));
    return success(res, { ...page, items: bills.filter((b) => b.bill !== null) });
  }

  const where = issuedWhere(filters);
  const [rows, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      orderBy: [{ issue_date: 'asc' }, { id: 'asc' }],
      skip: params.skip,
      take: params.limit,
      include: {
        order: { select: { id: true, order_number: true } },
        parent_order: { select: { id: true, order_number: true } },
        pdf: { select: { invoice_id: true } },
      },
    }),
    prisma.invoice.count({ where }),
  ]);
  // Lines the office left off a document are not on its paper, so not here.
  return success(res, paged(rows.map(({ hidden_lines: _left, pdf, ...doc }) => ({
    id: doc.id, invoice: doc, pdf_saved: pdf !== null,
  })), total, params));
}));

/** Who did it: an admin, or a rep with the code the office knows them by. */
async function whoDid(adminId: string | null, repUserId: string | null) {
  if (adminId) {
    const admin = await prisma.admin.findUnique({ where: { id: adminId }, select: { name: true } });
    return admin ? { name: admin.name, code: null, is_rep: false } : null;
  }
  if (repUserId) {
    const rep = await prisma.salesRep.findUnique({
      where: { user_id: repUserId },
      select: { code: true, user: { select: { name: true } } },
    });
    return rep ? { name: rep.user.name, code: rep.code, is_rep: true } : null;
  }
  return null;
}

// ─── GET /api/admin/documents/issued/:id ────────────────
//
// A factura or albarán to read, with what the archive says about it. Only an
// issued one: a draft has its own screen and is not in here.
router.get('/issued/:id', asyncHandler(async (req, res) => {
  if (!UUID.test(req.params.id)) return error(res, 'Document not found.', 404);
  const row = await prisma.invoice.findFirst({
    where: { id: req.params.id, status: 'issued' },
    include: {
      user: { select: { id: true, name: true, email: true, phone: true, tax_id: true } },
      order: { select: { id: true, order_number: true, status: true, deleted_at: true } },
      parent_order: {
        select: {
          id: true, order_number: true,
          sub_orders: { where: { deleted_at: null }, select: { status: true } },
        },
      },
      // Not its storage_key: where a file lives stays on the server.
      pdf: { select: { created_at: true, sha256: true, size_bytes: true, saved_by_admin_id: true, saved_by_sales_rep_id: true } },
    },
  });
  if (!row) return error(res, 'Document not found.', 404);

  const [issuedBy, draftedBy, pdfBy] = await Promise.all([
    whoDid(row.issued_by_admin_id, row.issued_by_sales_rep_id),
    whoDid(row.created_by_admin_id, row.created_by_sales_rep_id),
    row.pdf ? whoDid(row.pdf.saved_by_admin_id, row.pdf.saved_by_sales_rep_id) : null,
  ]);

  const { hidden_lines: _left, user, order, parent_order: parent, pdf, ...doc } = row;
  return success(res, {
    invoice: {
      ...doc,
      order: order ? { id: order.id, order_number: order.order_number } : null,
      parent_order: parent ? { id: parent.id, order_number: parent.order_number } : null,
    },
    issued_by: issuedBy,
    drafted_by: draftedBy,
    pdf: pdf ? { saved_at: pdf.created_at, sha256: pdf.sha256, size_bytes: pdf.size_bytes, saved_by: pdfBy } : null,
    client: user,
    order: order
      ? {
        id: order.id, order_number: order.order_number, status: order.status,
        deleted: order.deleted_at !== null, is_purchase: false,
      }
      : parent
        ? {
          id: parent.id, order_number: parent.order_number,
          status: deriveParentOrderStatus(parent.sub_orders.map((s) => s.status)),
          deleted: parent.sub_orders.length === 0, is_purchase: true,
        }
        : null,
  });
}));

// ─── GET /api/admin/documents/issued/:id/pdf ────────────
//
// The saved file itself, checked against the fingerprint taken when it was saved.
router.get('/issued/:id/pdf', asyncHandler(async (req, res) => {
  if (!UUID.test(req.params.id)) return error(res, 'Document not found.', 404);
  const doc = await prisma.invoice.findFirst({
    where: { id: req.params.id, status: 'issued' },
    select: { invoice_number: true },
  });
  if (!doc) return error(res, 'Document not found.', 404);

  const file = await readInvoicePdf(req.params.id);
  if (file.status === 'none') return error(res, 'No PDF has been saved for this document yet.', 404);
  if (file.status === 'altered') {
    return error(res, 'The saved PDF no longer matches its fingerprint, so it has not been shown.', 409);
  }
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${doc.invoice_number ?? req.params.id}.pdf"`);
  res.setHeader('Cache-Control', 'private, no-store');
  return res.end(file.bytes);
}));

// ─── POST /api/admin/documents/issued/:id/pdf ───────────
//
// Keep this document's PDF, if it has none yet: straight after issuing, or the
// first time an older one is opened. Lawyers reach this too, because opening a
// document that has no file is what saves it. A second file changes nothing.
router.post(
  '/issued/:id/pdf',
  pdfUpload.single('file') as unknown as import('express').RequestHandler,
  asyncHandler(async (req, res) => {
    if (!UUID.test(req.params.id)) return error(res, 'Document not found.', 404);
    const doc = await prisma.invoice.findFirst({
      where: { id: req.params.id, status: 'issued' },
      select: { id: true },
    });
    if (!doc) return error(res, 'Document not found.', 404);
    if (!req.file) return error(res, 'Send the PDF as field "file".', 400);

    const result = await saveInvoicePdf(doc.id, req.file.buffer, { adminId: req.admin?.adminId ?? null });
    if (result.status === 'not_pdf') return error(res, 'That is not a PDF.', 400);
    return success(res, result, result.status === 'saved' ? 201 : 200);
  }),
);

// ─── GET /api/admin/documents/bill/:id ──────────────────
//
// A bill to read, and the order behind it. By an order's id or a whole
// purchase's, as the bill itself is.
router.get('/bill/:id', asyncHandler(async (req, res) => {
  const bill = await billFor(req.params.id);
  if (!bill) return error(res, 'Document not found.', 404);

  const CLIENT = { select: { id: true, name: true, email: true, phone: true, tax_id: true } } as const;
  const single = await prisma.order.findFirst({
    where: { id: req.params.id, deleted_at: null, parent_order_id: null },
    select: {
      id: true, order_number: true, status: true, payment_method: true, created_at: true,
      address_snapshot: true, user: CLIENT,
    },
  });
  if (single) {
    const { user, address_snapshot: address, ...order } = single;
    return success(res, { bill, client: user, address, order: { ...order, is_purchase: false } });
  }

  // A part of a split purchase bills the whole of it, so the purchase is what to show.
  const part = await prisma.order.findFirst({
    where: { id: req.params.id, deleted_at: null },
    select: { parent_order_id: true },
  });
  const parent = await prisma.parentOrder.findUnique({
    where: { id: part?.parent_order_id ?? req.params.id },
    select: {
      id: true, order_number: true, payment_method: true, created_at: true, address_snapshot: true,
      user: CLIENT,
      sub_orders: { where: { deleted_at: null }, select: { status: true } },
    },
  });
  if (!parent) return error(res, 'Document not found.', 404);
  const { user, address_snapshot: address, sub_orders: parts, ...order } = parent;
  return success(res, {
    bill,
    client: user,
    address,
    order: { ...order, status: deriveParentOrderStatus(parts.map((s) => s.status)), is_purchase: true },
  });
}));

export default router;
