import { Router } from 'express';
import prisma from '../../lib/prisma';
import { success, error } from '../../lib/response';
import { asyncHandler } from '../../lib/async';
import { issueInvoice, subjectIdOf } from '../../lib/invoiceActions';
import { pdfUpload, saveInvoicePdf } from '../../lib/invoicePdf';

/**
 * A rep's own albaranes.
 *
 * ALBARANES ONLY (2026-11-07, user: "Factura will be only created and managed by
 * the admin itself"). An albarán prints exactly like a factura with ALBARÁN as
 * its title (2026-11-05), but it is not a fiscal document: it locks nothing and
 * is reissued whenever the order changes, so it is the document to hand a client
 * across a counter. A factura or a credit note is not a rep's to make, issue,
 * read or download, so to these routes it does not exist. The other document a
 * rep has is the Bill (GET /api/sales/orders/:id/bill).
 *
 * There is no editor and no delete either: detaching a draft from its order
 * and retyping prices is an office job.
 *
 * The rules themselves live in lib/invoiceActions.ts, shared with admin, so
 * there is one implementation of "one factura per sale" and one allocator for
 * the number series. What lives here is scope: a rep reaches the documents of
 * the orders they built, and a 404 for everything else.
 */
const router = Router();

/**
 * The albarán, if it belongs to an order this rep built.
 *
 * A document can hang off a whole PURCHASE rather than one order — a split
 * basket gets one albarán covering every part — so ownership is "any part of
 * it is mine", which is the same test the order detail route applies to let
 * them open a part at all.
 *
 * Answers null for somebody else's, and for anything that is not an albarán,
 * which the routes turn into 404 rather than 403: whether a factura exists is
 * not something to confirm from an id.
 */
/** The order numbers the factura's PEDIDO column prints. */
const ORDER_NUMBERS = {
  order: { select: { id: true, order_number: true } },
  parent_order: { select: { id: true, order_number: true } },
} as const;

async function ownInvoice(invoiceId: string, repId: string) {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId }, include: ORDER_NUMBERS });
  if (!invoice || invoice.kind !== 'albaran') return null;

  const mine = invoice.order_id
    ? await prisma.order.findFirst({
      where: { id: invoice.order_id, created_by_sales_rep_id: repId, deleted_at: null },
      select: { id: true },
    })
    : await prisma.order.findFirst({
      where: {
        parent_order_id: invoice.parent_order_id,
        created_by_sales_rep_id: repId,
        deleted_at: null,
      },
      select: { id: true },
    });

  return mine ? invoice : null;
}

/**
 * The document as a rep may have it: everything that prints, and not the
 * lines the office left off it (Invoice.hidden_lines, 2026-11-04). The PDF
 * never reads them, and a rep has no screen that does either — so they are
 * not sent at all rather than sent and trusted to stay unprinted.
 */
function forRep<T extends { hidden_lines?: unknown }>(invoice: T): Omit<T, 'hidden_lines'> {
  const { hidden_lines: _left, ...rest } = invoice;
  return rest;
}

// ─── GET /api/sales/invoices/:id ────────────────────────
//
// Read an albarán back to print it. The PDF is rendered in the browser from
// this payload — the same document component admin and partner use — so
// everything that prints has to be here: both snapshots, the lines, the totals
// and the number.
router.get('/:id', asyncHandler(async (req, res) => {
  const repId = req.salesRep!.user.id;
  const invoice = await ownInvoice(req.params.id, repId);
  if (!invoice) return error(res, 'Invoice not found.', 404);
  return success(res, forRep(invoice));
}));

// ─── POST /api/sales/invoices/:id/issue ─────────────────
//
// Allocate the number and make it permanent — for an albarán.
//
// A rep issues their own albaranes because a document with no number is not a
// document, and waiting for the office would mean leaving the counter without
// one. A FACTURA IS A 404 HERE even when it is a draft on their own order:
// admin may well have drafted one, and issuing it would burn a fiscal number,
// close the order to every further document and leave a correction that only
// a credit note can make — none of which is a rep's to set in motion.
router.post('/:id/issue', asyncHandler(async (req, res) => {
  const repId = req.salesRep!.user.id;
  const own = await ownInvoice(req.params.id, repId);
  if (!own) return error(res, 'Invoice not found.', 404);

  const result = await issueInvoice({ invoiceId: own.id, actor: { salesRepId: repId } });

  if (result.status === 'not_found') return error(res, 'Invoice not found.', 404);
  if (result.status === 'already_issued') return error(res, 'This invoice is already issued.', 409);
  if (result.status === 'order_gone') {
    return error(res, 'The order behind this document no longer exists.', 404);
  }
  if (result.status === 'blocked') {
    // Only what stops an albarán: the rest is about a factura, and the office's.
    return error(res, result.message, 422, { blockers: result.blockers.filter((b) => !b.albaran_ok) });
  }
  if (result.status === 'raced') {
    return error(res, 'This order already has an issued invoice.', 409);
  }
  // Read back with its order numbers: the rep prints straight from this.
  const printed = await prisma.invoice.findUnique({ where: { id: result.invoice.id }, include: ORDER_NUMBERS });
  return success(res, { invoice: forRep(printed ?? result.invoice), kind: result.kind });
}));

// ─── POST /api/sales/invoices/:id/pdf ───────────────────
//
// The exact PDF of an albarán the rep just issued, for the office's archive. They
// keep their copy: this cannot read one back, and cannot replace one already kept.
router.post(
  '/:id/pdf',
  pdfUpload.single('file') as unknown as import('express').RequestHandler,
  asyncHandler(async (req, res) => {
    const repId = req.salesRep!.user.id;
    const own = await ownInvoice(req.params.id, repId);
    if (!own) return error(res, 'Invoice not found.', 404);
    if (own.status !== 'issued') return error(res, 'Only an issued document has a PDF to keep.', 409);
    if (!req.file) return error(res, 'Send the PDF as field "file".', 400);

    const result = await saveInvoicePdf(own.id, req.file.buffer, { salesRepId: repId });
    if (result.status === 'not_pdf') return error(res, 'That is not a PDF.', 400);
    return success(res, { status: result.status }, result.status === 'saved' ? 201 : 200);
  }),
);

export { subjectIdOf };
export default router;
