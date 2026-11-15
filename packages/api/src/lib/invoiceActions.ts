import { Prisma } from '@prisma/client';
import prisma from './prisma';
import {
  getInvoicingSettings, invoiceBlockers, invoiceKindFor, documentBlockers,
  unreviewedVatProductIds,
  buildInvoiceLines, sellerSnapshot, buyerSnapshot, fillBlanks,
  allocateInvoiceNumber, formatInvoiceNumber, CONTINUOUS_YEAR,
  purchaseAsOneBasket, trackedLines, documentTotal, documentRecargo,
  type Blocker, type InvoiceLine, type HiddenInvoiceLine, type InvoiceTotals,
} from './invoicing';

/**
 * Drafting and issuing a document, for whoever is asking.
 *
 * Lifted out of routes/admin/invoices.ts unchanged, because a sales rep now
 * does both from their own screen and these are the rules of Spanish
 * invoicing, not rules about admins: one factura per sale, numbers allocated
 * from a series with no gaps, an albarán that can be reissued because it is a
 * quote. A second copy under /api/sales would be those rules written twice,
 * free to disagree about the one thing that must not.
 *
 * WHAT STAYS IN THE ROUTES is who may ask. Admin reaches any order; a rep
 * reaches only the ones they built, which their route proves before calling
 * in here. Nothing below checks it, and nothing below should: a lib that
 * sometimes enforces scope is worse than one that never does, because the
 * caller cannot tell which.
 */

/** Who is doing it. At most one id is ever set. */
export interface InvoiceActor {
  adminId?: string | null;
  salesRepId?: string | null;
}

/**
 * What this invoice is about — its order, or its whole purchase. The
 * `invoices_one_subject` CHECK guarantees exactly one is set, so the fallback
 * is unreachable rather than a default.
 */
export const subjectIdOf = (inv: { order_id: string | null; parent_order_id: string | null }) =>
  inv.order_id ?? inv.parent_order_id ?? '';

const ORDER_INCLUDE = {
  items: {
    include: {
      product: { select: { name_es: true, vat_category: true, vat_category_reviewed: true } },
      // Its code, for the factura's CÓDIGO column.
      variant: { select: { sku: true } },
    },
  },
  user: { select: { id: true, name: true, fiscal_name: true, tax_id: true, email: true, phone: true } },
} as const;

/**
 * Everything the UI needs to show a document and explain what it can become.
 *
 * TAKES AN ORDER *OR* A WHOLE PURCHASE. A split purchase is one ParentOrder
 * with a sub-order per shop, and the customer made one purchase — so it gets
 * one albarán and one factura covering all of it, not one per shop. The
 * parent is flattened by purchaseAsOneBasket() into the same shape a single
 * order has, so everything downstream — lines, totals, blockers, numbering —
 * works on one shape and does not need to know which it was handed.
 */
export async function assembleDraftContext(subjectId: string) {
  const single = await prisma.order.findUnique({ where: { id: subjectId }, include: ORDER_INCLUDE });

  const parent = single ? null : await prisma.parentOrder.findUnique({
    where: { id: subjectId },
    include: {
      user: { select: { id: true, name: true, fiscal_name: true, tax_id: true, email: true, phone: true } },
      sub_orders: { include: ORDER_INCLUDE, orderBy: { created_at: 'asc' } },
    },
  });
  if (!single && !parent) return null;

  /** The subject as one basket, whichever it actually is. */
  const order = single
    ?? (purchaseAsOneBasket(parent!) as unknown as NonNullable<typeof single>);

  const itemOrderIds = single ? [single.id] : parent!.sub_orders.map((s) => s.id);
  const subject = single
    ? { order_id: subjectId, parent_order_id: null }
    : { order_id: null, parent_order_id: subjectId };

  const [settings, unreviewed, issued] = await Promise.all([
    getInvoicingSettings(),
    unreviewedVatProductIds(itemOrderIds),
    // The issued FACTURA, if there is one — that is what closes an order to
    // further documents. An issued albaran does NOT: it is a quote, and
    // reissuing it when the order changes is what it is for.
    prisma.invoice.findFirst({
      where: { ...subject, status: 'issued', kind: 'invoice' },
      select: { id: true, invoice_number: true },
    }),
  ]);

  const blockers = invoiceBlockers({
    settings,
    order: { status: order.status, deleted_at: order.deleted_at },
    buyerTaxId: order.user.tax_id,
    unreviewedProductIds: unreviewed,
    alreadyInvoiced: !!issued,
  });

  return { order, settings, blockers, issued, subject, kind: invoiceKindFor(blockers) };
}

export type DraftResult =
  | { status: 'not_found' }
  | {
    status: 'blocked';
    /** The one to put in the HTTP message; the rest are for the list. */
    message: string;
    blockers: Blocker[];
    existing: { id: string; invoice_number: string | null } | null;
  }
  | { status: 'ok'; invoice: Prisma.InvoiceGetPayload<object>; blockers: Blocker[]; kind: 'albaran' | 'invoice'; created: boolean };

/**
 * Create the draft, or hand back the one that already exists. Deliberately
 * idempotent: pressing the button twice should land on the same document, not
 * create a second one to choose between.
 *
 * `requestedKind` omitted means the best one the blockers allow. Asking
 * explicitly matters in both directions: somebody who wants an albarán for a
 * fully invoiceable order could not get one when the kind was derived, so
 * eligibility silently became obligation — and somebody expecting a factura
 * got an albarán with no statement of why.
 */
export async function draftInvoice(args: {
  subjectId: string;
  requestedKind?: 'albaran' | 'invoice';
  actor: InvoiceActor;
}): Promise<DraftResult> {
  const ctx = await assembleDraftContext(args.subjectId);
  if (!ctx) return { status: 'not_found' };

  const hard = ctx.blockers.filter((b) => !b.albaran_ok);
  if (hard.length > 0) {
    return { status: 'blocked', message: hard[0].message, blockers: ctx.blockers, existing: ctx.issued };
  }

  /**
   * A FACTURA WITH GAPS IS STILL DRAFTED.
   *
   * This refused any requested factura with a blocker of any kind, which read
   * as "it will not let me generate it": a product whose IVA nobody had ticked
   * was enough, and the fix was three other screens away. But the draft is
   * where those fields are typed — it has an editor for the seller, the buyer
   * and every line — so refusing to create it withheld the one place the
   * problem could be solved.
   *
   * Only the structural refusals remain: an order already invoiced, cancelled,
   * deleted, or still a stock draft holding nothing. Those are the ones no
   * field on the document can answer, and `fix_on_document` is what says so.
   * The gaps come back with the draft, and `documentBlockers()` decides at
   * ISSUE time whether they were filled.
   */
  if (args.requestedKind === 'invoice') {
    const refusing = ctx.blockers.filter((b) => !b.fix_on_document);
    if (refusing.length > 0) {
      return {
        status: 'blocked',
        message: refusing.map((b) => b.message).join(' '),
        blockers: ctx.blockers,
        existing: ctx.issued,
      };
    }
  }

  const kind: 'albaran' | 'invoice' =
    args.requestedKind ?? (ctx.kind === 'invoice' ? 'invoice' : 'albaran');

  // Hand back an open draft rather than stacking a second one. A previously
  // ISSUED albaran is deliberately not matched here: the order has moved on
  // since, and a fresh draft carrying the new totals is exactly what is being
  // asked for.
  const sameKind = await prisma.invoice.findFirst({
    where: { ...ctx.subject, status: 'draft', kind },
  });
  if (sameKind) {
    return { status: 'ok', invoice: sameKind, blockers: ctx.blockers, kind, created: false };
  }

  /**
   * ONLY THE OFFICE MAY SWITCH A DRAFT'S KIND. Nothing is issued yet, so for
   * them switching is just answering the question again.
   *
   * A rep's albarán used to come through here too, which turned a factura the
   * office had in draft into an albarán, hand-typed lines and all, and the rep's
   * next step issued it. A factura is the office's alone (2026-11-07), so a rep
   * gets an albarán of their own beside it and the office's draft is left alone.
   */
  if (!args.actor.salesRepId) {
    const otherKind = await prisma.invoice.findFirst({
      where: { ...ctx.subject, status: 'draft' },
    });
    if (otherKind) {
      const draft = await prisma.invoice.update({ where: { id: otherKind.id }, data: { kind } });
      return { status: 'ok', invoice: draft, blockers: ctx.blockers, kind, created: false };
    }
  }

  const { lines, totals } = buildInvoiceLines(ctx.order);
  const invoice = await prisma.invoice.create({
    data: {
      kind,
      status: 'draft',
      // Whichever this is — one order, or one whole purchase.
      ...ctx.subject,
      user_id: ctx.order.user_id,
      seller_snapshot: sellerSnapshot(ctx.settings) as unknown as Prisma.InputJsonValue,
      buyer_snapshot: buyerSnapshot(ctx.order.user, ctx.order.address_snapshot) as unknown as Prisma.InputJsonValue,
      lines: lines as unknown as Prisma.InputJsonValue,
      totals: totals as unknown as Prisma.InputJsonValue,
      taxable_base: new Prisma.Decimal(totals.base),
      vat_total: new Prisma.Decimal(totals.vat),
      // Recargo de equivalencia, as the order or purchase is charged it.
      recargo_equivalencia: !!ctx.order.recargo_equivalencia,
      recargo_total: new Prisma.Decimal(documentRecargo(totals)),
      total: new Prisma.Decimal(documentTotal(totals)),
      payment_terms: ctx.settings.payment_terms || null,
      created_by_admin_id: args.actor.adminId ?? null,
      created_by_sales_rep_id: args.actor.salesRepId ?? null,
    },
  });

  return { status: 'ok', invoice, blockers: ctx.blockers, kind, created: true };
}

export type IssueResult =
  | { status: 'not_found' }
  | { status: 'order_gone' }
  | { status: 'already_issued' }
  | { status: 'blocked'; message: string; blockers: Blocker[] }
  | { status: 'raced' }
  | { status: 'ok'; invoice: Prisma.InvoiceGetPayload<object>; kind: 'albaran' | 'invoice' };

/** Allocate a number and make the document permanent. */
export async function issueInvoice(args: {
  invoiceId: string;
  actor: InvoiceActor;
}): Promise<IssueResult> {
  const invoice = await prisma.invoice.findUnique({ where: { id: args.invoiceId } });
  if (!invoice) return { status: 'not_found' };
  if (invoice.status === 'issued') return { status: 'already_issued' };

  const ctx = await assembleDraftContext(subjectIdOf(invoice));
  if (!ctx) return { status: 'order_gone' };

  const hard = ctx.blockers.filter((b) => !b.albaran_ok);
  if (hard.length > 0) return { status: 'blocked', message: hard[0].message, blockers: ctx.blockers };

  // THE DRAFT'S OWN KIND, not the best one the blockers currently allow.
  // Recomputing here would have overridden the choice at the one moment it
  // becomes permanent: an albarán drafted on purpose for an invoiceable order
  // would have gone out as a factura, burning a factura number nobody asked
  // for. A factura still has to re-prove itself, because the blockers can
  // regress between drafting and issuing.
  const kind: 'albaran' | 'invoice' = invoice.kind === 'invoice' ? 'invoice' : 'albaran';
  const series = kind === 'invoice' ? ctx.settings.series_invoice : ctx.settings.series_albaran;
  const issuedAt = new Date();

  /**
   * The parties, healed first — because the heal is what decides the answer.
   *
   * fillBlanks pulls the company's fiscal details and the customer's CIF in
   * from their records without overwriting anything typed on the draft. A
   * factura drafted before the settings row existed therefore becomes
   * complete here, and checking the document BEFORE healing it would refuse
   * documents that are about to be fine.
   */
  const healedSeller = fillBlanks(invoice.seller_snapshot, sellerSnapshot(ctx.settings));
  const healedBuyer = fillBlanks(
    invoice.buyer_snapshot,
    buyerSnapshot(ctx.order.user, ctx.order.address_snapshot),
  );

  /**
   * A FACTURA IS JUDGED ON ITSELF, not on the records behind it.
   *
   * This used to refuse if any blocker at all was present, which meant an
   * unreviewed IVA category in the catalogue stopped a document whose rates
   * the admin had just gone through line by line. What a factura actually
   * needs is its own fields: who is billing, their CIF and address, and the
   * buyer's CIF. Anything still missing comes back named, and it is named as
   * something to type HERE.
   *
   * Structural refusals still apply, unchanged — already invoiced, cancelled,
   * deleted, or an order that is still a stock draft.
   */
  if (kind === 'invoice') {
    const refusing = ctx.blockers.filter((b) => !b.fix_on_document);
    const gaps = documentBlockers({
      seller_snapshot: healedSeller as Prisma.JsonValue,
      buyer_snapshot: healedBuyer as Prisma.JsonValue,
    });
    const stopping = [...refusing, ...gaps];
    if (stopping.length > 0) {
      return {
        status: 'blocked',
        message: stopping.map((b) => b.message).join(' '),
        blockers: [...ctx.blockers, ...gaps.filter((g) => !ctx.blockers.some((b) => b.code === g.code))],
      };
    }
  }

  // Recomputed from the order, EXCEPT on a draft somebody edited by hand.
  //
  // A detached draft (see Invoice.manually_edited) is no longer a view of its
  // order — that is what detaching means. Rebuilding it here would have thrown
  // away every edited price, quantity, discount and IVA rate at the instant
  // the document became immutable, leaving an issued factura that disagreed
  // with the screen the admin pressed Issue on, with no way to correct it
  // short of a credit note.
  //
  // Either way the lines somebody HID stay hidden (2026-11-04): a following
  // draft is rebuilt with the same keys left off, and an edited one already
  // holds them apart. What issues is what the screen showed as printed.
  const tracked = invoice.manually_edited ? null : trackedLines(ctx.order, invoice);
  const lines = tracked
    ? tracked.lines
    : invoice.lines as unknown as InvoiceLine[];
  const hiddenLines = tracked
    ? tracked.hidden_lines
    : (invoice.hidden_lines as unknown as HiddenInvoiceLine[]);
  const totals = tracked
    ? tracked.totals
    : (invoice.totals as unknown as InvoiceTotals);

  // Nothing left to print — every line hidden, or the order shrank under a
  // draft until only hidden ones remained. A document of no lines is not one.
  if (lines.length === 0) {
    return {
      status: 'blocked',
      message: 'Every line on this document is hidden. Show at least one before issuing it.',
      blockers: [],
    };
  }

  try {
    const issued = await prisma.$transaction(async (tx) => {
      // One counter per series that never resets (lib/invoicing CONTINUOUS_YEAR).
      const number = await allocateInvoiceNumber(tx, series);
      return tx.invoice.update({
        where: { id: invoice.id },
        data: {
          kind,
          status: 'issued',
          series,
          year: CONTINUOUS_YEAR,
          number,
          invoice_number: formatInvoiceNumber(series, number),
          issue_date: issuedAt,
          // Healed, not replaced. Overwriting from settings would discard a
          // seller the admin corrected on the draft; leaving the buyer
          // untouched would issue the blanks it was created with. Either way
          // the issued document would differ from the one approved on screen.
          seller_snapshot: healedSeller as unknown as Prisma.InputJsonValue,
          buyer_snapshot: healedBuyer as unknown as Prisma.InputJsonValue,
          lines: lines as unknown as Prisma.InputJsonValue,
          hidden_lines: hiddenLines as unknown as Prisma.InputJsonValue,
          totals: totals as unknown as Prisma.InputJsonValue,
          taxable_base: new Prisma.Decimal(totals.base),
          vat_total: new Prisma.Decimal(totals.vat),
          recargo_total: new Prisma.Decimal(documentRecargo(totals)),
          total: new Prisma.Decimal(documentTotal(totals)),
          issued_by_admin_id: args.actor.adminId ?? null,
          issued_by_sales_rep_id: args.actor.salesRepId ?? null,
        },
      });
    }, { maxWait: 5_000, timeout: 8_000 });

    return { status: 'ok', invoice: issued, kind };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      // The partial unique index caught a second issued invoice for this
      // order — two people pressing Issue at once.
      return { status: 'raced' };
    }
    throw err;
  }
}
