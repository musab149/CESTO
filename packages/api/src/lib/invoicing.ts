import { Prisma, type OrderStatus } from '@prisma/client';
import prisma from './prisma';
import { deriveParentOrderStatus } from './parentOrder';

import {
  computeTaxBreakdown, eurosToCents, centsToEuros, rateForCategory, effectiveVatCategory,
  removeVatCents, recargoCents, recargoBasisPoints,
  type VatCategory,
} from './tax';

/**
 * Invoicing: settings, blockers, numbering, and building a draft.
 *
 * The shape of this module is set by one fact — the two things a Spanish
 * factura cannot legally be issued without are not in place:
 *
 *   1. the seller's CIF/NIF (terms-and-conditions.md still says `[CIF/NIF]`);
 *   2. a VAT rate somebody actually confirmed per product. Every row sits on
 *      the schema's `reduced` default with `vat_category_reviewed = false`,
 *      and nothing has ever written those columns.
 *
 * So a document is a ALBARÁN until both clear, and says so on its face.
 * `invoiceKindFor()` is the single place that decision is made; the moment
 * the blockers clear it returns `invoice` and the same pipeline produces a
 * real factura with no other change.
 */

export const INVOICING_SETTINGS_KEY = 'invoicing';

export interface InvoicingSettings {
  /** Legal name of the issuer. Not the storefront brand. */
  legal_name: string;
  /** CIF or NIF. While blank, nothing can be issued as a factura. */
  tax_id: string;
  address: string;
  postcode: string;
  city: string;
  province: string;
  country: string;
  email: string;
  phone: string;
  /** Prefix for full invoices, e.g. FA-000123 (one counter, never reset). */
  series_invoice: string;
  /** Prefix for albaranes, kept separate so the numbering never mixes. */
  series_albaran: string;
  /** Free text printed under the totals. */
  payment_terms: string;
}

export const DEFAULT_INVOICING: InvoicingSettings = {
  legal_name: '',
  tax_id: '',
  address: '',
  postcode: '',
  city: '',
  province: '',
  country: 'España',
  email: '',
  phone: '',
  series_invoice: 'FA',
  series_albaran: 'ALB',
  payment_terms: '',
};

/**
 * Its own AppSetting key, not part of the `store` blob.
 *
 * Three reasons. Legal identity should not be entangled with marketing
 * config in a schema that is already carrying accept-and-discard legacy
 * keys; "is invoicing configured?" needs to be a clean predicate for gating
 * the Issue button; and this can be locked to super_admin without locking
 * down the whole Settings page.
 */
export async function getInvoicingSettings(): Promise<InvoicingSettings> {
  const row = await prisma.appSetting.findUnique({ where: { key: INVOICING_SETTINGS_KEY } });
  const stored = (row?.config ?? {}) as Partial<InvoicingSettings>;
  // A settings blob written before 2026-10-02 carries `series_proforma`.
  // Spreading `stored` over the defaults would drop it and silently renumber
  // anyone who had customised their prefix, so it is mapped across first and
  // the new key still wins if both are present.
  const legacy = (stored as Record<string, unknown>).series_proforma;
  const migrated = typeof legacy === 'string' && legacy.trim() !== ''
    ? { series_albaran: legacy, ...stored }
    : stored;
  return { ...DEFAULT_INVOICING, ...migrated };
}

export async function saveInvoicingSettings(next: InvoicingSettings): Promise<InvoicingSettings> {
  await prisma.appSetting.upsert({
    where: { key: INVOICING_SETTINGS_KEY },
    create: { key: INVOICING_SETTINGS_KEY, config: next as unknown as Prisma.InputJsonValue },
    update: { config: next as unknown as Prisma.InputJsonValue },
  });
  return next;
}

/** Configured enough to issue a real factura? */
export function isInvoicingConfigured(s: InvoicingSettings): boolean {
  return s.legal_name.trim() !== '' && s.tax_id.trim() !== '' && s.address.trim() !== '';
}

// ─── Blockers ─────────────────────────────────────────────

export type BlockerCode =
  | 'seller_not_configured'
  | 'unreviewed_vat'
  | 'buyer_tax_id_missing'
  | 'order_cancelled'
  | 'order_deleted'
  | 'order_draft'
  | 'already_invoiced';

export interface Blocker {
  code: BlockerCode;
  /** Shown to the admin, in Spanish — this is an admin-facing surface. */
  message: string;
  /** True when it only stops a full factura, not an albarán. */
  albaran_ok: boolean;
  /**
   * This is MISSING DATA, and the draft is where it gets typed in.
   *
   * The three of these — the company's fiscal details, a reviewed IVA rate, a
   * buyer CIF — used to refuse the factura outright, which put the admin in a
   * loop: go to Ajustes, go to each product, go to the customer, come back,
   * press the button again. Meanwhile the document that wants those fields was
   * sitting right there, fully editable, with a field for each of them.
   *
   * So they no longer refuse. A factura can be drafted with gaps and the gaps
   * are filled on the document; `documentBlockers()` is what then decides
   * whether it can be ISSUED, reading the document rather than the records it
   * came from. The structural ones (cancelled, deleted, already invoiced, a
   * draft order holding no stock) are false here: nothing an admin types on
   * the document makes those sales invoiceable.
   */
  fix_on_document: boolean;
  /** Product ids an admin can go and fix, for `unreviewed_vat`. */
  product_ids?: string[];
}

/**
 * Why this order cannot be invoiced, or can only be an albarán.
 *
 * Returned from both the draft and the issue attempt on purpose. A rep should
 * see the reason while looking at the document, not discover it when they
 * press the button.
 */
export function invoiceBlockers(args: {
  settings: InvoicingSettings;
  order: { status: string; deleted_at: Date | null };
  buyerTaxId: string | null;
  unreviewedProductIds: string[];
  /**
   * An issued FACTURA already exists for this order.
   *
   * Not "any issued document". A albaran is a quote, and reissuing it when
   * the order changes is the entire point of having one — so an existing
   * albaran blocks nothing. A factura is a fiscal document, one per sale,
   * and once it exists the correction is a credit note.
   */
  alreadyInvoiced: boolean;
}): Blocker[] {
  const out: Blocker[] = [];

  if (args.alreadyInvoiced) {
    out.push({
      code: 'already_invoiced',
      message: 'Este pedido ya tiene una factura emitida. La corrección se hace con un abono.',
      albaran_ok: false,
      fix_on_document: false,
    });
  }
  if (args.order.deleted_at) {
    out.push({
      code: 'order_deleted', message: 'El pedido está eliminado.',
      albaran_ok: false, fix_on_document: false,
    });
  }
  // A DRAFT order has reserved nothing. Its stock was never decremented —
  // resolving it is what books the goods, and it can stay unresolvable
  // forever if the stock never comes back. Billing for that is billing for
  // something that may never ship.
  //
  // But it is only half a blocker. A ALBARÁN is a quote, and quoting a shop
  // for goods you are trying to source is exactly what a rep standing at
  // their counter needs to do. So a draft can be quoted and can never be
  // invoiced, which is `albaran_ok: true` doing precisely its job.
  if (args.order.status === 'draft') {
    out.push({
      code: 'order_draft',
      message: 'El pedido está pendiente de stock. Se puede presupuestar, pero no facturar hasta confirmarlo.',
      albaran_ok: true,
      // NOT fixable on the document, and the only soft blocker that is not.
      // A draft order reserved no stock; billing for it is billing for goods
      // that may never ship, and no field on the invoice changes that.
      fix_on_document: false,
    });
  }
  if (args.order.status === 'cancelled') {
    out.push({
      code: 'order_cancelled', message: 'El pedido está cancelado.',
      albaran_ok: false, fix_on_document: false,
    });
  }
  if (!isInvoicingConfigured(args.settings)) {
    out.push({
      code: 'seller_not_configured',
      message: 'Faltan los datos fiscales de la empresa (nombre legal, CIF/NIF y dirección). Rellénalos en Ajustes → Facturación o aquí mismo, en el documento.',
      albaran_ok: true,
      fix_on_document: true,
    });
  }
  if (args.unreviewedProductIds.length > 0) {
    out.push({
      code: 'unreviewed_vat',
      message: `${args.unreviewedProductIds.length} producto(s) tienen un tipo de IVA sin revisar. Comprueba el tipo en cada línea antes de emitir.`,
      albaran_ok: true,
      fix_on_document: true,
      product_ids: args.unreviewedProductIds,
    });
  }
  if (!args.buyerTaxId || args.buyerTaxId.trim() === '') {
    out.push({
      code: 'buyer_tax_id_missing',
      message: 'El cliente no tiene CIF/NIF. Una factura completa lo necesita — puedes escribirlo aquí, en el documento.',
      albaran_ok: true,
      fix_on_document: true,
    });
  }

  return out;
}

/**
 * What the FACTURA ITSELF is still missing, read from the document.
 *
 * This is the gate that replaced "every upstream record must be perfect". A
 * factura is a statement by the seller about one sale, and everything it has
 * to carry is a field on the document: who is billing, their CIF, their
 * address, and who is being billed with theirs. Where those values originally
 * came from — an AppSetting, the customer record — stops mattering the moment
 * somebody types them here, which is exactly what `PUT /api/admin/invoices/:id`
 * is for and exactly what an admin wanted to do when the old gate sent them
 * off to three other screens instead.
 *
 * Deliberately NOT a check of the IVA rates. Every line carries a rate, and
 * whether it was reviewed in the catalogue is a question about the catalogue;
 * on the document the rate is the admin's to confirm, and `vat_source` already
 * records whether a human did. An unreviewed rate still shows as a blocker so
 * nobody issues one unknowingly — it just no longer refuses.
 *
 * Reads the snapshot the document will actually PRINT. The seller's name on a
 * factura is `legal_name` (see FacturaDocument), so that is the field checked;
 * `name` is accepted as a fallback for drafts written before the editor could
 * set it.
 */
export function documentBlockers(invoice: {
  seller_snapshot: Prisma.JsonValue;
  buyer_snapshot: Prisma.JsonValue;
}): Blocker[] {
  const out: Blocker[] = [];
  const seller = (invoice.seller_snapshot ?? {}) as Record<string, unknown>;
  const buyer = (invoice.buyer_snapshot ?? {}) as Record<string, unknown>;
  const filled = (v: unknown) => typeof v === 'string' && v.trim() !== '';

  const sellerName = filled(seller.legal_name) || filled(seller.name);
  if (!sellerName || !filled(seller.tax_id) || !filled(seller.address)) {
    out.push({
      code: 'seller_not_configured',
      message: 'La factura necesita el nombre legal, el CIF/NIF y la dirección de quien emite. Rellénalos en el documento.',
      albaran_ok: true,
      fix_on_document: true,
    });
  }
  if (!filled(buyer.tax_id)) {
    out.push({
      code: 'buyer_tax_id_missing',
      message: 'La factura necesita el CIF/NIF del cliente. Escríbelo en el documento.',
      albaran_ok: true,
      fix_on_document: true,
    });
  }
  return out;
}

/** What this document can legally be, given its blockers. */
export function invoiceKindFor(blockers: Blocker[]): 'albaran' | 'invoice' | null {
  if (blockers.some((b) => !b.albaran_ok)) return null;
  return blockers.length === 0 ? 'invoice' : 'albaran';
}

// ─── Numbering ────────────────────────────────────────────

/**
 * The year an invoice belongs to, in Madrid rather than UTC.
 *
 * An invoice issued at 00:30 on 1 January CET is 23:30 on 31 December UTC.
 * Stamping the UTC year puts it in the wrong series and leaves what looks
 * like a gap in both — and a gap in a factura series is the one thing the
 * numbering exists to prevent.
 */
export function madridYear(date: Date): number {
  return Number(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid', year: 'numeric',
  }).format(date));
}

/**
 * A split purchase as ONE basket, in the same shape a single order has.
 *
 * A purchase gets one albaran and one factura covering all of it, so
 * everything downstream — lines, totals, blockers, numbering — works on one
 * shape and never needs to know which it was handed.
 *
 * The two fields that are NOT a straight copy are the ones that have been
 * wrong before:
 *
 *   delivery_fee  The PARENT's own fee. A purchase is delivered once and
 *                 charged for once, so checkout puts the whole fee on the
 *                 parent and writes 0 on every sub-order. Summing the subs
 *                 gives zero and the document drops a fee the customer is
 *                 being charged — on a factura, understating what is owed.
 *   deleted_at    A purchase is gone only when EVERY part of it is.
 */
export function purchaseAsOneBasket<
  Sub extends {
    status: OrderStatus;
    deleted_at: Date | null;
    items: unknown[];
    address_snapshot: unknown;
  },
  P extends { delivery_fee_total: Prisma.Decimal; sub_orders: Sub[] },
>(parent: P) {
  // DELETED SHOPS ARE NOT BILLED. One part of a purchase can be deleted on
  // its own, and those goods are not being supplied — charging for them is
  // the same kind of error as omitting the delivery fee, in the opposite
  // direction. The status is likewise derived from what is still live, or a
  // purchase whose only cancelled part was deleted would keep reporting
  // cancelled.
  const live = parent.sub_orders.filter((s) => !s.deleted_at);

  return {
    ...parent,
    status: deriveParentOrderStatus((live.length > 0 ? live : parent.sub_orders).map((s) => s.status)),
    // A purchase is gone only when EVERY part of it is.
    deleted_at: parent.sub_orders.every((s) => s.deleted_at) ? new Date() : null,
    items: live.flatMap((s) => s.items),
    delivery_fee: parent.delivery_fee_total,
    address_snapshot: (live[0] ?? parent.sub_orders[0])?.address_snapshot ?? {},
  };
}

/**
 * The issued FACTURA that locks this order, if there is one.
 *
 * Asks the order AND the purchase it belongs to. A split purchase is invoiced
 * ONCE, as a whole, so its factura hangs off `parent_order_id` and none of
 * its sub-orders carry one of their own. A guard that only asks `order_id`
 * is therefore blind on exactly the orders that are invoiced, and would let
 * a rep edit or hide one shop's part of a purchase whose total is already
 * stated on a document the customer is holding.
 *
 * ONLY A FACTURA LOCKS. An albaran is not a fiscal document — it is a quote,
 * and revising a quote is what a quote is for.
 */
export async function issuedFacturaFor(
  tx: Prisma.TransactionClient,
  subject:
    | { id: string; parent_order_id: string | null }
    | Array<{ id: string; parent_order_id: string | null }>,
): Promise<{ invoice_number: string | null } | null> {
  // Takes one order or several, because deleting a whole purchase has to ask
  // the same question about every part of it at once — one query, not one per
  // shop, and a factura on any of them stops the lot.
  const orders = Array.isArray(subject) ? subject : [subject];
  if (orders.length === 0) return null;
  const parentIds = [...new Set(
    orders.map((o) => o.parent_order_id).filter((p): p is string => !!p),
  )];

  return tx.invoice.findFirst({
    where: {
      status: 'issued',
      kind: 'invoice',
      OR: [
        { order_id: { in: orders.map((o) => o.id) } },
        ...(parentIds.length > 0 ? [{ parent_order_id: { in: parentIds } }] : []),
      ],
    },
    select: { invoice_number: true },
  });
}

/**
 * NUMBERS NEVER RESET (user, 2026-11-04: "the factura number will start from
 * 0 and keeps on increasing from there on"): ONE counter per series, for
 * good — FA-000000, FA-000001, … and ALB-000000, … — where there used to be
 * one per calendar year (FA-2026-000001, back to 1 every January).
 *
 * The counter lives in invoice_series, and each document is stamped, under
 * this `year`, which no real year can be:
 *  - the yearly counters from before stay where they are, untouched, and the
 *    documents issued under them keep their numbers (an issued number is
 *    never rewritten);
 *  - the unique index on invoices (series, year, number) keeps meaning "no
 *    number twice": the old FA-2026-000001 sits at (FA, 2026, 1), so the new
 *    FA-000001 at (FA, 0, 1) can never collide with it. (A NULL year would
 *    have switched the index off — NULLs never clash.)
 * The issue DATE is on every document as always (`issue_date`).
 */
export const CONTINUOUS_YEAR = 0;

/**
 * The next number in a series, allocated inside the caller's transaction.
 *
 * Gap-free BY CONSTRUCTION. The UPDATE takes a row-level write lock: a second
 * concurrent issue blocks on it, and if the first transaction rolls back —
 * validation failed, stock check failed, Neon timed out — the counter rolls
 * back with it and the second gets the same number. There is no state in
 * which a number exists without the invoice that claimed it.
 *
 * This is why it is a row and not a Postgres sequence: nextval() is
 * deliberately non-transactional and burns a number on every rollback.
 *
 * Call it LAST, immediately before the insert, so the lock is held for
 * microseconds rather than for the whole transaction.
 *
 * Starts at 0: the row is created at -1, "none issued yet".
 */
export async function allocateInvoiceNumber(
  tx: Prisma.TransactionClient,
  series: string,
): Promise<number> {
  await tx.$executeRaw`
    INSERT INTO invoice_series (id, series, year, last_number, updated_at)
    VALUES (gen_random_uuid(), ${series}, ${CONTINUOUS_YEAR}, -1, now())
    ON CONFLICT (series, year) DO NOTHING
  `;
  const rows = await tx.$queryRaw<{ last_number: number }[]>`
    UPDATE invoice_series
       SET last_number = last_number + 1, updated_at = now()
     WHERE series = ${series} AND year = ${CONTINUOUS_YEAR}
    RETURNING last_number
  `;
  return rows[0].last_number;
}

/** FA-000123: the series and the number, six digits — no year (see CONTINUOUS_YEAR). */
export function formatInvoiceNumber(series: string, number: number): string {
  return `${series}-${String(number).padStart(6, '0')}`;
}

// ─── Draft construction ───────────────────────────────────

export interface InvoiceLine {
  description: string;
  quantity: number;
  /** VAT-inclusive unit price, as a 2-decimal string. */
  unit_price: string;
  /**
   * One unit WITHOUT IVA, 2 decimals (since 2026-11-04) — read out of
   * `unit_price`, never printed. Prices are bases with IVA added on top
   * (2026-11-01), so when a rate is changed on a document the editor re-adds
   * IVA to this base and the price and total follow (user: "when I apply the
   * iva then nothing changes in total"). Absent on documents from before;
   * `unitBaseOf` derives it exactly.
   */
  unit_base?: string;
  /**
   * Flat euros taken off this line before `gross`, as a 2-decimal string.
   * Absent when none was given. A discount that vanishes between the order
   * and the invoice is the kind of thing customers write in about, so it is
   * stated on the document rather than silently folded into the total.
   */
  discount?: string;
  /** VAT-inclusive line total, already NET of `discount`. */
  gross: string;
  rate_pct: number;
  /**
   * Where the rate came from, so a reader can judge how much to trust it.
   * The document marks `default` with an asterisk: "Tipo de IVA no revisado".
   *
   *   product   a band somebody confirmed, on the product or on this line
   *   default   a product band nobody has reviewed, still the placeholder
   *   delivery  the delivery line, taxed by the rule in buildInvoiceLines
   */
  vat_source: 'product' | 'default' | 'delivery';
  product_id: string | null;
  /**
   * Which line this is, however the list moves: the order item's id, `delivery`
   * for the fee, or `manual:<uuid>` for a line typed on the document. It is
   * what a hidden line is remembered by (2026-11-04). Absent on documents
   * drafted before then.
   */
  key?: string;
  /**
   * The product's code (the size's `sku`) for the CÓDIGO column of the
   * factura (2026-11-04). Null when the size has none or for a line that is
   * not a product (the fee, a typed line); absent on older documents.
   */
  code?: string | null;
}

/**
 * A line the office chose to leave off the document (user, 2026-11-04: "hide
 * any item from the factura and it should not affect the order"). Kept beside
 * the printed lines, never among them, so nothing that prints, totals or
 * issues a document can let it slip back in: `Invoice.lines` is always exactly
 * what the paper says. `at` is where it sat in the full list, so showing it
 * again puts it back where it was.
 */
export interface HiddenInvoiceLine extends InvoiceLine {
  at: number;
}

export interface InvoiceTotals {
  by_rate: Array<{
    rate_pct: number; base: string; vat: string; gross: string;
    /** Recargo de equivalencia for this rate, when the document charges it (2026-11-04). */
    recargo_pct?: number;
    recargo?: string;
  }>;
  base: string;
  vat: string;
  /** Base + IVA — what the lines charge. */
  gross: string;
  /** Recargo de equivalencia on the whole document; absent when it charges none. */
  recargo?: string;
  /**
   * What the document comes to: base + IVA + recargo. Absent on documents
   * from before 2026-11-04, where it is `gross` (documentTotal).
   */
  total?: string;
  /**
   * Everything taken off the lines, summed. '0.00' when nothing was. Shown
   * beside the totals so the saving is legible without reading every line.
   */
  discount_total: string;
}

/**
 * Turn an order into invoice lines and totals.
 *
 * Delivery is a taxed line at the general rate, not an untaxed extra.
 * Transport charged to a customer is part of the taxable base; leaving it out
 * understates the VAT due. It is separated out visually on the document but
 * it is a line like any other here.
 */
export function buildInvoiceLines(order: {
  items: Array<{
    /** The order item's id — the line's `key`. Every real caller has it. */
    id?: string;
    product_id: string;
    /** The size sold, for its code. */
    variant?: { sku: string | null } | null;
    quantity: number;
    unit_price: Prisma.Decimal;
    discount_amount?: Prisma.Decimal | null;
    line_total: Prisma.Decimal;
    /** The IVA rate the line was charged with (since 2026-11-01); null before. */
    tax_rate_pct?: number | null;
    product_snapshot: Prisma.JsonValue;
    product?: { name_es: string; vat_category: VatCategory; vat_category_reviewed: boolean } | null;
  }>;
  delivery_fee: Prisma.Decimal;
  /** Under recargo de equivalencia (Order / ParentOrder.recargo_equivalencia). */
  recargo_equivalencia?: boolean;
}, deliveryVat: VatCategory = 'general'): { lines: InvoiceLine[]; totals: InvoiceTotals } {
  const lines: InvoiceLine[] = order.items.map((item) => {
    const snap = item.product_snapshot as Record<string, unknown> | null;
    const name = item.product?.name_es
      ?? (typeof snap?.name_es === 'string' ? snap.name_es : 'Producto');
    // The rate the line was charged with, so the IVA backed out of it is the
    // IVA that was added to it; a line from before lines recorded one takes
    // its product's band as it stands (0 % until somebody picks one).
    const rate = item.tax_rate_pct ?? rateForCategory(effectiveVatCategory(item.product));
    const discount = item.discount_amount ?? null;
    return {
      description: name,
      quantity: item.quantity,
      unit_price: item.unit_price.toFixed(2),
      // The base this price was charged from, at the rate it was charged at.
      unit_base: baseOfPrice(item.unit_price.toFixed(2), rate),
      ...(discount && discount.gt(0) ? { discount: discount.toFixed(2) } : {}),
      // Already net of the discount — editOrder writes line_total that way,
      // so the VAT below is computed on what was actually charged.
      gross: item.line_total.toFixed(2),
      rate_pct: rate,
      // REVIEWED, not merely present. Every line has a product, so asking
      // whether it had one marked nothing: unreviewed bands went out
      // unmarked, and the asterisk landed on the delivery line instead.
      vat_source: item.product?.vat_category_reviewed ? 'product' : 'default',
      product_id: item.product_id,
      ...(item.id ? { key: item.id } : {}),
      code: item.variant?.sku?.trim() || null,
    };
  });

  if (!order.delivery_fee.isZero()) {
    lines.push({
      description: 'Gastos de envío',
      quantity: 1,
      unit_price: order.delivery_fee.toFixed(2),
      unit_base: baseOfPrice(order.delivery_fee.toFixed(2), rateForCategory(deliveryVat)),
      gross: order.delivery_fee.toFixed(2),
      rate_pct: rateForCategory(deliveryVat),
      vat_source: 'delivery',
      product_id: null,
      key: 'delivery',
      code: null,
    });
  }

  return { lines, totals: invoiceTotals(lines, { recargo: !!order.recargo_equivalencia }) };
}

/**
 * What a list of lines adds up to — the totals block of a document.
 *
 * From the lines alone, so whatever is printed is exactly what is summed: a
 * hidden line is not in the list and so not in the total. The discount is the
 * lines' own (`discount` is only set where one was taken), which is the same
 * figure the order items carry.
 */
export function invoiceTotals(
  lines: InvoiceLine[],
  /**
   * The document charges RECARGO DE EQUIVALENCIA (2026-11-04): rate by rate,
   * on the same base as IVA (lib/tax recargoCents) — the same figures the
   * order was charged (lib/orderTotals recargoFor), as both group the lines
   * the same way.
   */
  opts: { recargo?: boolean } = {},
): InvoiceTotals {
  const breakdown = computeTaxBreakdown(
    lines.map((l) => ({ grossCents: eurosToCents(l.gross), rate_pct: l.rate_pct })),
  );
  const discountTotalCents = lines.reduce(
    (sum, l) => sum + (l.discount ? eurosToCents(l.discount) : 0),
    0,
  );
  const recargoByRate = breakdown.groups.map((g) => (opts.recargo ? recargoCents(g.base_cents, g.rate_pct) : 0));
  const recargoCentsTotal = recargoByRate.reduce((a, b) => a + b, 0);
  return {
    by_rate: breakdown.groups.map((g, i) => ({
      rate_pct: g.rate_pct,
      base: centsToEuros(g.base_cents),
      vat: centsToEuros(g.vat_cents),
      gross: centsToEuros(g.gross_cents),
      ...(opts.recargo ? { recargo_pct: recargoBasisPoints(g.rate_pct) / 100, recargo: centsToEuros(recargoByRate[i]) } : {}),
    })),
    base: centsToEuros(breakdown.taxable_base_cents),
    vat: centsToEuros(breakdown.vat_total_cents),
    discount_total: centsToEuros(discountTotalCents),
    gross: centsToEuros(breakdown.gross_total_cents),
    ...(opts.recargo ? { recargo: centsToEuros(recargoCentsTotal) } : {}),
    total: centsToEuros(breakdown.gross_total_cents + recargoCentsTotal),
  };
}

/** What a document comes to — its `total`, or `gross` on one from before recargo. */
export function documentTotal(t: Pick<InvoiceTotals, 'gross' | 'total'>): string {
  return t.total ?? t.gross;
}

/** The recargo a document charges, as stored beside its totals; '0.00' when none. */
export function documentRecargo(t: Pick<InvoiceTotals, 'recargo'>): string {
  return t.recargo ?? '0.00';
}

// ─── The base and the rate (2026-11-04) ───────────────────

/** A price with IVA, back to the base it carries at `ratePct` (exact — lib/tax). */
export function baseOfPrice(unitPrice: string, ratePct: number): string {
  return centsToEuros(removeVatCents(eurosToCents(unitPrice), ratePct));
}

/** A line's base: stored, or derived from its price for a document older than the field. */
export function unitBaseOf(line: Pick<InvoiceLine, 'unit_base' | 'unit_price' | 'rate_pct'>): string {
  return line.unit_base ?? baseOfPrice(line.unit_price, line.rate_pct);
}

// ─── Hidden lines (2026-11-04) ────────────────────────────

/** The keys of a document's hidden lines, read off whatever is stored. */
export function hiddenKeysOf(hidden: unknown): Set<string> {
  const rows = Array.isArray(hidden) ? hidden as Array<{ key?: unknown }> : [];
  return new Set(rows.map((h) => h.key).filter((k): k is string => typeof k === 'string'));
}

/**
 * The full list again — printed lines with the hidden ones put back where
 * they sat. What an admin is choosing from when they hide or show a line.
 */
export function allLinesOf(lines: unknown, hidden: unknown): InvoiceLine[] {
  const out = [...(Array.isArray(lines) ? lines as InvoiceLine[] : [])];
  const back = (Array.isArray(hidden) ? hidden as HiddenInvoiceLine[] : [])
    .slice()
    .sort((a, b) => a.at - b.at);
  for (const { at, ...line } of back) {
    out.splice(Math.min(Math.max(0, at), out.length), 0, line);
  }
  return out;
}

/**
 * Split a full list into what prints and what is hidden, and total the
 * printed part. A key nobody has (an item since removed from the order, a
 * stale tab) hides nothing.
 */
export function splitHidden(
  all: InvoiceLine[],
  hiddenKeys: ReadonlySet<string>,
  /** The document charges recargo de equivalencia on what it prints. */
  opts: { recargo?: boolean } = {},
): {
  lines: InvoiceLine[];
  hidden_lines: HiddenInvoiceLine[];
  totals: InvoiceTotals;
} {
  const lines: InvoiceLine[] = [];
  const hidden_lines: HiddenInvoiceLine[] = [];
  all.forEach((l, at) => {
    if (l.key && hiddenKeys.has(l.key)) hidden_lines.push({ ...l, at });
    else lines.push(l);
  });
  return { lines, hidden_lines, totals: invoiceTotals(lines, opts) };
}

/**
 * A draft that still follows its order, rebuilt from it: fresh lines, the same
 * lines kept hidden (by key, so it survives items being added or removed
 * around them), and any description somebody typed carried over.
 *
 * Descriptions are matched by key; a draft written before lines had keys has
 * no hidden lines either, so for it position is still the right match.
 */
export function trackedLines(
  order: Parameters<typeof buildInvoiceLines>[0],
  stored: { lines: unknown; hidden_lines: unknown },
): ReturnType<typeof splitHidden> {
  const fresh = buildInvoiceLines(order).lines;
  const before = allLinesOf(stored.lines, stored.hidden_lines);
  const keyed = before.some((l) => l.key);
  const byKey = new Map(before.filter((l) => l.key).map((l) => [l.key as string, l.description]));
  const described = fresh.map((l, i) => ({
    ...l,
    description: (keyed ? (l.key ? byKey.get(l.key) : undefined) : before[i]?.description) ?? l.description,
  }));
  return splitHidden(described, hiddenKeysOf(stored.hidden_lines), { recargo: !!order.recargo_equivalencia });
}

export function sellerSnapshot(s: InvoicingSettings) {
  return {
    legal_name: s.legal_name,
    tax_id: s.tax_id,
    address: s.address,
    postcode: s.postcode,
    city: s.city,
    province: s.province,
    country: s.country,
    email: s.email,
    phone: s.phone,
  };
}

export function buyerSnapshot(user: {
  name: string;
  fiscal_name: string | null;
  tax_id: string | null;
  email: string | null;
  phone: string | null;
}, address: Prisma.JsonValue) {
  const a = (address ?? {}) as Record<string, unknown>;
  return {
    name: user.fiscal_name?.trim() || user.name,
    tax_id: user.tax_id ?? null,
    email: user.email,
    phone: user.phone,
    address: [a.street_line_1, a.street_line_2].filter(Boolean).join(', '),
    postcode: a.postcode ?? null,
    city: a.city ?? null,
    province: a.province ?? null,
  };
}

/**
 * Fill blank fields of a stored party snapshot from the current source.
 *
 * A snapshot is taken when the draft is created, so anything configured after
 * that — the company's own fiscal identity, a customer's CIF — is missing from
 * it forever. The draft then renders an empty "Issued by" block, and worse,
 * passes the buyer_tax_id blocker (which reads the live user) while printing
 * no CIF at all, producing a factura that is not valid as one.
 *
 * Blanks only. A value somebody typed into the draft is an override and
 * survives; a field nobody ever filled takes the current truth. Blanking a
 * field deliberately is not expressible this way, which is the right trade for
 * a document whose empty fields are a legal problem.
 */
export function fillBlanks<T extends Record<string, unknown>>(
  stored: Prisma.JsonValue | null | undefined,
  source: T,
): T {
  const cur = (stored ?? {}) as Record<string, unknown>;
  const out = { ...source };
  for (const k of Object.keys(source) as Array<keyof T>) {
    const v = cur[k as string];
    const present = v !== null && v !== undefined && String(v).trim() !== '';
    if (present) out[k] = v as T[keyof T];
  }
  return out;
}

/** Products on this order whose VAT rate nobody has confirmed. */
export async function unreviewedVatProductIds(orderIds: string | string[]): Promise<string[]> {
  const ids = Array.isArray(orderIds) ? orderIds : [orderIds];
  const rows = await prisma.orderItem.findMany({
    // A split purchase is invoiced as one document, so an unreviewed rate on
    // ANY of its shops blocks the factura for all of it.
    where: { order_id: { in: ids }, product: { vat_category_reviewed: false } },
    select: { product_id: true },
    distinct: ['product_id'],
  });
  return rows.map((r) => r.product_id);
}
