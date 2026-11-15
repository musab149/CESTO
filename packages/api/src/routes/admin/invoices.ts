import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { success, error } from '../../lib/response';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/async';
import { parsePage, paged } from '../../lib/pagination';
import { requireRole } from '../../middleware/adminAuth';
import { randomUUID } from 'crypto';
import {
  getInvoicingSettings, saveInvoicingSettings,
  buildInvoiceLines, sellerSnapshot, buyerSnapshot, fillBlanks, documentBlockers,
  // One totaller for an edited draft, a following one and an issued document,
  // so the three can never add the same lines up differently.
  invoiceTotals, trackedLines, splitHidden, allLinesOf, hiddenKeysOf,
  baseOfPrice, unitBaseOf, documentTotal, documentRecargo,
  type InvoiceLine, type HiddenInvoiceLine, type InvoiceTotals,
} from '../../lib/invoicing';
import { eurosToCents, centsToEuros } from '../../lib/tax';
// Drafting and issuing live in a lib because a sales rep does both from their
// own screen now — see lib/invoiceActions.ts. These routes keep what is
// genuinely admin's: the settings, the list, the editor, and deleting a draft.
import { assembleDraftContext, subjectIdOf, draftInvoice, issueInvoice } from '../../lib/invoiceActions';

const router = Router();

const invoicingSettingsSchema = z.object({
  legal_name: z.string().trim().max(200),
  tax_id: z.string().trim().max(32),
  address: z.string().trim().max(300),
  postcode: z.string().trim().max(10),
  city: z.string().trim().max(100),
  province: z.string().trim().max(100),
  country: z.string().trim().max(100),
  email: z.string().trim().max(200),
  phone: z.string().trim().max(40),
  // Short and uppercase: this prefix is printed on every document in the
  // series and cannot be changed once one has been issued under it.
  series_invoice: z.string().trim().regex(/^[A-Z]{1,8}$/, 'Use 1-8 uppercase letters'),
  series_albaran: z.string().trim().regex(/^[A-Z]{1,8}$/, 'Use 1-8 uppercase letters'),
  payment_terms: z.string().trim().max(500),
});

router.get('/invoicing-settings', asyncHandler(async (_req, res) =>
  success(res, await getInvoicingSettings())));

// super_admin only. This is the company's legal identity, and it is the
// first real role boundary in the admin API — requireRole currently guards
// only the irreversible destroys.
router.put(
  '/invoicing-settings',
  requireRole('super_admin'),
  validate(invoicingSettingsSchema),
  asyncHandler(async (req, res) => {
    const next = req.body as z.infer<typeof invoicingSettingsSchema>;
    // Changing a series prefix after something has been issued under it
    // would split one legal series across two names.
    const current = await getInvoicingSettings();
    if (next.series_invoice !== current.series_invoice) {
      const used = await prisma.invoice.count({
        where: { series: current.series_invoice, status: 'issued' },
      });
      if (used > 0) {
        return error(res, `Series "${current.series_invoice}" already has issued invoices and cannot be renamed.`, 422);
      }
    }
    return success(res, await saveInvoicingSettings(next));
  }),
);

// ─── POST /api/admin/orders/:id/invoice ─────────────────
//
// Create the draft, or hand back the one that already exists. Deliberately
// idempotent: a rep pressing the button twice should land on the same
// document, not create a second one to choose between.
const createInvoiceSchema = z.object({
  /**
   * Which document to draft. Omitted = the old behaviour, the best one the
   * blockers allow.
   *
   * Asking explicitly matters in both directions. A rep who wants an albarán
   * for a fully invoiceable order could not get one — the kind was derived,
   * so eligibility silently became obligation. And someone expecting a
   * factura got an albarán with no statement of why; now the refusal names
   * every blocker instead of quietly downgrading.
   */
  kind: z.enum(['albaran', 'invoice']).optional(),
}).strict();

router.post('/orders/:id/invoice', validate(createInvoiceSchema), asyncHandler(async (req, res) => {
  const { kind: requested } = req.body as z.infer<typeof createInvoiceSchema>;
  const result = await draftInvoice({
    subjectId: req.params.id,
    requestedKind: requested,
    actor: { adminId: req.admin?.adminId ?? null },
  });

  if (result.status === 'not_found') return error(res, 'Order not found.', 404);
  if (result.status === 'blocked') {
    return error(res, result.message, 422, { blockers: result.blockers, existing: result.existing });
  }
  return success(
    res,
    { invoice: result.invoice, blockers: result.blockers, kind: result.kind },
    result.created ? 201 : 200,
  );
}));

// ─── GET /api/admin/invoices ────────────────────────────
router.get('/invoices', asyncHandler(async (req, res) => {
  const params = parsePage(req.query, 25, 100);
  const { status, kind, user_id, q } = req.query as Record<string, string | undefined>;

  const where: Prisma.InvoiceWhereInput = {};
  if (status === 'draft' || status === 'issued') where.status = status;
  if (kind === 'albaran' || kind === 'invoice' || kind === 'credit_note') where.kind = kind;
  if (user_id) where.user_id = user_id;
  if (q) {
    where.OR = [
      { invoice_number: { contains: q, mode: 'insensitive' } },
      { order: { order_number: { contains: q, mode: 'insensitive' } } },
      { user: { name: { contains: q, mode: 'insensitive' } } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      orderBy: [{ issue_date: 'desc' }, { created_at: 'desc' }],
      skip: params.skip,
      take: params.limit,
      include: {
        user: { select: { id: true, name: true } },
        order: { select: { id: true, order_number: true } },
      },
    }),
    prisma.invoice.count({ where }),
  ]);

  return success(res, paged(items, total, params));
}));

// ─── GET /api/admin/invoices/:id ────────────────────────
router.get('/invoices/:id', asyncHandler(async (req, res) => {
  const invoice = await prisma.invoice.findUnique({
    where: { id: req.params.id },
    include: {
      user: { select: { id: true, name: true, tax_id: true } },
      order: { select: { id: true, order_number: true, status: true, deleted_at: true } },
      // A split purchase's document hangs off the purchase: its number is
      // the one the factura's PEDIDO column prints.
      parent_order: { select: { id: true, order_number: true } },
    },
  });
  if (!invoice) return error(res, 'Invoice not found.', 404);

  // Recomputed live rather than stored, so a draft reflects a CIF added or a
  // VAT category reviewed since it was created.
  const ctx = invoice.status === 'draft' ? await assembleDraftContext(subjectIdOf(invoice)) : null;

  // A draft that has been edited by hand no longer tracks its order — see
  // Invoice.manually_edited. Blockers are still computed, because whether the
  // document CAN be issued is a different question from what it says.
  const tracksOrder = ctx != null && !invoice.manually_edited;

  // A DRAFT tracks its order. The delivery fee and the items can both change
  // after the draft exists — that is the point of a draft — and an invoice
  // that quietly disagrees with the order it bills is a reconciliation
  // problem nobody finds until an accountant does.
  //
  // Only the money is refreshed; any description an admin overrode is kept,
  // matched by position, exactly as the issue path does it.
  let current = invoice;
  if (ctx) {
    // THE PARTIES HEAL ON ANY DRAFT, detached or not. `manually_edited` means
    // the LINES no longer track the order; it says nothing about who the
    // document is from and to. A draft created before the company's fiscal
    // details were saved kept an empty "Issued by" block for the rest of its
    // life, and a buyer whose CIF arrived later still printed none — while the
    // blocker, which reads the live user, had already cleared. fillBlanks
    // never overwrites a value somebody typed, so an override still survives.
    const seller = fillBlanks(invoice.seller_snapshot, sellerSnapshot(ctx.settings));
    const buyer = fillBlanks(
      invoice.buyer_snapshot,
      buyerSnapshot(ctx.order.user, ctx.order.address_snapshot),
    );

    // The money only tracks while the draft does — and the lines somebody hid
    // stay hidden through it, matched by key (lib/invoicing trackedLines).
    let merged = invoice.lines as unknown as InvoiceLine[];
    let hidden = invoice.hidden_lines as unknown as HiddenInvoiceLine[];
    let totals = invoice.totals as unknown as InvoiceTotals;
    if (tracksOrder) {
      const fresh = trackedLines(ctx.order, invoice);
      merged = fresh.lines;
      hidden = fresh.hidden_lines;
      totals = fresh.totals;
    } else if (merged.some((l) => !l.key || !l.unit_base || !('code' in l))) {
      // A draft edited by hand before lines had keys, bases and codes: give
      // each one, so any of them can be hidden and re-rated and prints its
      // product code. The base is read out of the price exactly; a line that
      // is an order item takes its size's code.
      const codeOf = new Map(
        (ctx.order.items as Array<{ id: string; variant?: { sku: string | null } | null }>)
          .map((i) => [i.id, i.variant?.sku?.trim() || null]),
      );
      merged = merged.map((l) => ({
        ...l,
        key: l.key ?? `manual:${randomUUID()}`,
        unit_base: unitBaseOf(l),
        code: 'code' in l ? (l.code ?? null) : (l.key ? codeOf.get(l.key) ?? null : null),
      }));
    }

    // The document's recargo de equivalencia follows its order's (copied when
    // the order was placed; kept in step here while it is a draft). The
    // office can add it to an order after the fact (lib/orderRecargo), so a
    // draft edited by hand is re-totalled on its own lines when the regime
    // changes — a following draft already was, by trackedLines.
    const underRecargo = !!ctx.order.recargo_equivalencia;
    if (!tracksOrder && underRecargo !== invoice.recargo_equivalencia) {
      totals = invoiceTotals(merged, { recargo: underRecargo });
    }
    const changed = JSON.stringify(merged) !== JSON.stringify(invoice.lines)
      || underRecargo !== invoice.recargo_equivalencia
      || JSON.stringify(hidden) !== JSON.stringify(invoice.hidden_lines)
      || JSON.stringify(totals) !== JSON.stringify(invoice.totals)
      || JSON.stringify(seller) !== JSON.stringify(invoice.seller_snapshot)
      || JSON.stringify(buyer) !== JSON.stringify(invoice.buyer_snapshot);

    if (changed) {
      current = await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          lines: merged as unknown as Prisma.InputJsonValue,
          hidden_lines: hidden as unknown as Prisma.InputJsonValue,
          totals: totals as unknown as Prisma.InputJsonValue,
          seller_snapshot: seller as unknown as Prisma.InputJsonValue,
          buyer_snapshot: buyer as unknown as Prisma.InputJsonValue,
          taxable_base: new Prisma.Decimal(totals.base),
          vat_total: new Prisma.Decimal(totals.vat),
          recargo_equivalencia: underRecargo,
          recargo_total: new Prisma.Decimal(documentRecargo(totals)),
          total: new Prisma.Decimal(documentTotal(totals)),
        },
        include: {
          user: { select: { id: true, name: true, tax_id: true } },
          order: { select: { id: true, order_number: true, status: true, deleted_at: true } },
          parent_order: { select: { id: true, order_number: true } },
        },
      });
    }
  }

  // Which lines no longer say what the order says. Computed, never stored:
  // the order can change after the draft detaches, so the answer is only
  // true at the moment it is asked.
  //
  // Position-matched, because that is how the draft was built from the order
  // in the first place. A line added or deleted by hand shifts everything
  // after it, which the UI reads as divergence — correctly, since those lines
  // no longer correspond to the order items they sit opposite.
  let divergence: number[] = [];
  if (ctx && invoice.manually_edited) {
    // The order's lines less the ones hidden here, so a hidden line does not
    // shift every line after it into "differs from the order".
    const hiddenKeys = hiddenKeysOf(current.hidden_lines);
    const fresh = buildInvoiceLines(ctx.order).lines.filter((l) => !(l.key && hiddenKeys.has(l.key)));
    const edited = current.lines as unknown as Array<Record<string, unknown>>;
    divergence = edited.flatMap((l, i) => {
      const f = fresh[i];
      if (!f) return [i];
      const same = String(l.quantity) === String(f.quantity)
        && String(l.unit_price) === String(f.unit_price)
        && String(l.gross) === String(f.gross);
      return same ? [] : [i];
    });
    if (fresh.length !== edited.length) {
      for (let i = edited.length; i < fresh.length; i += 1) divergence.push(i);
    }
  }

  return success(res, {
    invoice: current,
    blockers: ctx?.blockers ?? [],
    /**
     * What the DOCUMENT still needs before it can go out as a factura, as
     * opposed to what is imperfect in the records behind it.
     *
     * The screen gates its Issue button on this and only this. `blockers`
     * stays as it was — it is the fuller picture, and an unreviewed IVA
     * category is worth telling an admin about even though it no longer
     * refuses anything — but a document whose own fields are complete is
     * issuable, and that is the question the button is asking.
     *
     * Computed on `current`, i.e. AFTER the parties have healed from
     * settings and the customer record, so it matches what issuing will do.
     */
    document_blockers: current.status === 'draft' ? documentBlockers(current) : [],
    kind: ctx?.kind ?? invoice.kind,
    /** Indexes of lines that no longer match the order. Empty while the draft
     *  still tracks it, which is the normal case. */
    divergence,
  });
}));

// ─── PUT /api/admin/invoices/:id ────────────────────────
//
// Drafts only. An issued invoice is immutable — the database enforces it too
// (trigger invoices_no_mutate_issued), because an application check is one
// forgotten code path away from being no check at all.
const partySchema = z.object({
  name: z.string().trim().max(200).optional(),
  /**
   * The seller's name on a factura, which is the field the document prints
   * (FacturaDocument reads `seller.legal_name`, not `name`). It was not
   * accepted here, so the one way to correct the company name on a document
   * was to go and change the settings — and the editor's Name box wrote
   * `name`, which nothing rendered. Both are taken now and kept in step
   * below, so either spelling works whichever way the draft was written.
   */
  legal_name: z.string().trim().max(200).optional(),
  tax_id: z.string().trim().max(60).nullable().optional(),
  address: z.string().trim().max(300).optional(),
  postcode: z.string().trim().max(20).optional(),
  city: z.string().trim().max(120).optional(),
  province: z.string().trim().max(120).optional(),
  country: z.string().trim().max(120).optional(),
  email: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(60).optional(),
}).strict();

const updateSchema = z.object({
  notes: z.string().max(2000).nullable().optional(),
  payment_terms: z.string().max(500).nullable().optional(),
  /** Both parties are editable: a draft is where a wrong CIF or a stale
   *  trading address gets fixed, and neither is worth re-issuing over. */
  buyer: partySchema.optional(),
  seller: partySchema.optional(),
  /**
   * The lines, in full. Replaced rather than patched, because reordering,
   * adding and deleting are all things an admin may need and an index-keyed
   * patch cannot express any of them.
   *
   * Money IS editable here, which the old schema refused on the grounds that
   * an invoice must agree with its order. That is still a real risk — it is
   * now surfaced as a per-line divergence flag on read, rather than prevented.
   */
  lines: z.array(z.object({
    description: z.string().trim().min(1).max(300),
    quantity: z.number().int().min(1).max(100000),
    /**
     * One unit WITH IVA — the price the customer saw, and the one the
     * document prints. The editor re-adds IVA to the line's base when its
     * rate changes (shared invoiceLinePrice) and sends the result here; the
     * base stored beside it is read back out of this.
     */
    unit_price: z.string().regex(/^\d{1,8}(\.\d{1,2})?$/),
    discount: z.string().regex(/^\d{1,8}(\.\d{1,2})?$/).optional(),
    rate_pct: z.number().int().min(0).max(100),
    product_id: z.string().uuid().nullable().optional(),
    /**
     * The CÓDIGO printed for the line (2026-11-04): this document's only —
     * the product's sku is never changed. Absent keeps the line's code as it
     * was (older screens never send one); empty clears it.
     */
    code: z.string().trim().max(40).nullable().optional(),
    /** The line's key as the draft gave it; a new line gets one here. */
    key: z.string().trim().min(1).max(80).optional(),
  })).min(1).max(300).optional(),
  /**
   * The keys of every line to leave off the document — the whole set, so
   * showing a line again is sending the set without it (2026-11-04).
   *
   * Unlike `lines`, this does NOT detach the draft: hiding is a choice about
   * the paper, not an edit of what was sold, so the draft keeps following its
   * order and the order itself is never touched.
   */
  hidden: z.array(z.string().trim().min(1).max(80)).max(400).optional(),
}).strict();

router.put('/invoices/:id', validate(updateSchema), asyncHandler(async (req, res) => {
  const body = req.body as z.infer<typeof updateSchema>;
  const invoice = await prisma.invoice.findUnique({ where: { id: req.params.id } });
  if (!invoice) return error(res, 'Invoice not found.', 404);
  if (invoice.status === 'issued') {
    return error(res, 'An issued invoice cannot be edited. Issue a credit note instead.', 409);
  }

  // Merge rather than replace: a party snapshot carries fields this schema
  // does not name, and dropping them would quietly empty the document.
  const mergeParty = (snap: unknown, patch?: Record<string, unknown>) =>
    (patch ? { ...(snap as Record<string, unknown>), ...patch } : snap) as Prisma.InputJsonValue;

  /**
   * `legal_name` and `name` say the same thing about the seller, and different
   * code reads each: the PDF prints `legal_name`, the settings row writes
   * `legal_name`, and a party editor naturally sends `name`. Mirroring the one
   * that was given into the one that was not means a corrected company name
   * reaches the document whichever field it arrived in, without this route
   * having to care which screen sent it.
   */
  const sellerPatch = body.seller
    ? (() => {
      const patch: Record<string, unknown> = { ...body.seller };
      if (patch.legal_name === undefined && typeof patch.name === 'string') {
        patch.legal_name = patch.name;
      }
      if (patch.name === undefined && typeof patch.legal_name === 'string') {
        patch.name = patch.legal_name;
      }
      return patch;
    })()
    : undefined;

  let lines = invoice.lines as unknown as InvoiceLine[];
  let hiddenLines = invoice.hidden_lines as unknown as HiddenInvoiceLine[];
  let totals: InvoiceTotals | null = null;

  if (body.lines) {
    const keys = new Set<string>();
    // The lines as they were, by key: an edited line keeps its product code.
    const before = new Map(
      allLinesOf(invoice.lines, invoice.hidden_lines).filter((l) => l.key).map((l) => [l.key as string, l]),
    );
    lines = body.lines.map((l) => {
      const qty = l.quantity;
      // Every line keeps a key of its own, so any of them can be hidden later;
      // a repeated one would hide two lines at once.
      const key = l.key && !keys.has(l.key) ? l.key : `manual:${randomUUID()}`;
      keys.add(key);
      // The price WITH IVA is the truth, as everywhere a customer sees one;
      // its base is read back out of it (exactly, for any price checkout
      // made) and kept beside it, so a later change of rate has one to
      // re-add IVA to.
      const unitPrice = centsToEuros(eurosToCents(l.unit_price));
      const unitBase = baseOfPrice(unitPrice, l.rate_pct);
      // Whole cents: a float line total can be a cent out.
      const offCents = l.discount ? eurosToCents(l.discount) : 0;
      const grossCents = Math.max(0, qty * eurosToCents(unitPrice) - offCents);
      return {
        description: l.description,
        quantity: qty,
        unit_price: unitPrice,
        unit_base: unitBase,
        ...(offCents > 0 ? { discount: centsToEuros(offCents) } : {}),
        gross: centsToEuros(grossCents),
        rate_pct: l.rate_pct,
        // The rate came from a human now, so say so: the document's asterisk
        // means "nobody confirmed this", and somebody just did.
        vat_source: 'product' as const,
        product_id: l.product_id ?? null,
        key,
        code: l.code !== undefined ? (l.code || null) : (before.get(key)?.code ?? null),
      };
    });
    // A line printed again is no longer hidden as well.
    hiddenLines = hiddenLines.filter((h) => !h.key || !keys.has(h.key));
    // Recomputed here rather than trusted from the client. The totals are the
    // part an inspection checks; they are derived, never submitted.
    totals = invoiceTotals(lines, { recargo: invoice.recargo_equivalencia });
  }

  if (body.hidden) {
    const split = splitHidden(allLinesOf(lines, hiddenLines), new Set(body.hidden), { recargo: invoice.recargo_equivalencia });
    if (split.lines.length === 0) {
      return error(res, 'A document needs at least one line. Show another line before hiding this one.', 422);
    }
    lines = split.lines;
    hiddenLines = split.hidden_lines;
    totals = split.totals;
  }

  const updated = await prisma.invoice.update({
    where: { id: invoice.id },
    data: {
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
      ...(body.payment_terms !== undefined ? { payment_terms: body.payment_terms } : {}),
      buyer_snapshot: mergeParty(invoice.buyer_snapshot, body.buyer),
      seller_snapshot: mergeParty(invoice.seller_snapshot, sellerPatch),
      lines: lines as unknown as Prisma.InputJsonValue,
      hidden_lines: hiddenLines as unknown as Prisma.InputJsonValue,
      ...(totals ? {
        totals: totals as unknown as Prisma.InputJsonValue,
        taxable_base: new Prisma.Decimal(totals.base),
        vat_total: new Prisma.Decimal(totals.vat),
        recargo_total: new Prisma.Decimal(documentRecargo(totals)),
        total: new Prisma.Decimal(documentTotal(totals)),
      } : {}),
      // Editing the figures detaches the draft from its order. Without this
      // the next GET rebuilds the lines from the order and the edit is gone
      // before anyone sees it saved. Hiding alone does not: it changes the
      // paper, not what was sold.
      ...(body.lines ? { manually_edited: true } : {}),
    },
  });

  return success(res, updated);
}));

router.post('/invoices/:id/issue', asyncHandler(async (req, res) => {
  const result = await issueInvoice({
    invoiceId: req.params.id,
    actor: { adminId: req.admin?.adminId ?? null },
  });

  if (result.status === 'not_found') return error(res, 'Invoice not found.', 404);
  if (result.status === 'already_issued') return error(res, 'This invoice is already issued.', 409);
  if (result.status === 'order_gone') {
    return error(res, 'The order behind this invoice no longer exists.', 404);
  }
  if (result.status === 'blocked') {
    return error(res, result.message, 422, { blockers: result.blockers });
  }
  if (result.status === 'raced') {
    return error(res, 'This order already has an issued invoice.', 409);
  }
  return success(res, { invoice: result.invoice, kind: result.kind });
}));

// ─── DELETE /api/admin/invoices/:id ─────────────────────
router.delete('/invoices/:id', asyncHandler(async (req, res) => {
  const invoice = await prisma.invoice.findUnique({ where: { id: req.params.id } });
  if (!invoice) return error(res, 'Invoice not found.', 404);
  if (invoice.status === 'issued') {
    return error(res, 'An issued invoice cannot be deleted.', 409);
  }
  await prisma.invoice.delete({ where: { id: invoice.id } });
  return success(res, { message: 'Draft deleted.' });
}));

export default router;
