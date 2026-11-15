import type { CSSProperties, ReactNode } from 'react';
import type { Invoice } from '../api/services/admin';
import { eurosToCents } from '../tax';

/**
 * The factura / albarán itself, for rasterising to PDF.
 *
 * THE LAYOUT (2026-11-04) is the classic Spanish trade invoice the user
 * handed over from a supplier: the seller on the left, the customer in a
 * rounded box on the right; a grey header strip (FECHA · FACTURA · PEDIDO ·
 * N.I.F · TELÉFONO · PÁG.); a coded lines table; "SUMA ANTERIOR" / "SUMA Y
 * SIGUE" carried between pages; and at the foot the bases per rate with their
 * IVA and the total in a box. Spanish throughout — it is a Spanish fiscal
 * document (FACTURA_LABELS_ES).
 *
 * THE LINES PRINT WITH IVA (user, 2026-11-05) — PRECIO, DTO. and IMPORTE are
 * what the customer was charged, exactly as the editor and the order show
 * them, so PRECIO − DTO. = IMPORTE on every row. Discounts are taken off the
 * price WITH IVA everywhere in the system; printed without IVA, a 2 € discount
 * came out as 1,9231 next to a price of 10,00 and read as a mistake. The foot
 * still states the base and the IVA per rate (and recargo), which is what a
 * factura must break out. (2026-11-04 to -05 the lines printed WITHOUT IVA,
 * reconciled to the per-rate base by facturaLineBases, kept below for that
 * reason and its tests.)
 *
 * HOW THE BASES WERE WORKED OUT, when the lines printed without IVA. Customers are charged
 * prices WITH IVA, rounded to the cent per unit, and that charge is the truth
 * every line records (`gross`). A line WITHOUT IVA is read back out of it at
 * the line's rate. Read out one by one, those amounts need not add up to the
 * base the document's totals state for that rate (the totals back IVA out of
 * each rate's whole, so base + IVA is exactly what was paid) — so the cents
 * are shared out across the rate's lines, each within a cent of its exact
 * value, until they do (facturaLineBases). A unit price or discount that is
 * not a whole cent without IVA prints to four decimals rather than being
 * rounded into a figure that does not multiply out.
 *
 * ALL STYLES ARE INLINE, deliberately: html2canvas rasterises against
 * whatever CSS happens to be live, and a stale Tailwind bundle once rendered a
 * logo at its native 1042px. Inline styles cannot be affected by that.
 *
 * Renders from the FROZEN snapshot on the invoice — seller_snapshot,
 * buyer_snapshot, lines, totals — never from live settings or the order.
 *
 * IT PAGINATES, before rendering: html2canvas rasterises what it is handed,
 * and nothing downstream can split a table row without cutting through it.
 * Every page repeats the header and strip (a sheet that comes loose from the
 * staple has to say which document it is, and the strip carries PÁG.).
 *
 * AN ALBARÁN IS THE SAME DOCUMENT with ALBARÁN where FACTURA goes (user,
 * 2026-11-05: "exactly looking like factura, only difference … it will say
 * albaran") — customer, prices, IVA and totals included. It used to name no
 * customer, state no money and carry a "Documento no fiscal" notice. Its
 * number is from its own series (ALB-…), which is what tells the two apart.
 */

export interface FacturaLabels {
  albaranTitle: string;
  invoiceTitle: string;
  creditNoteTitle: string;
  /** Header strip. */
  date: string;
  /** In the number's box while the document is a draft — it has none until issued. */
  draftNumber: string;
  orderRef: string;
  taxId: string;
  phone: string;
  page: string;
  /** The seller's block. */
  sellerPhone: string;
  sellerTaxId: string;
  /** Lines table. */
  code: string;
  description: string;
  qty: string;
  unitPrice: string;
  discount: string;
  vatRate: string;
  lineTotal: string;
  /** Carried between pages. */
  carriedIn: string;
  carriedOut: string;
  /** Foot. */
  totalBase: string;
  base: string;
  ratePct: string;
  vat: string;
  /** Recargo de equivalencia columns, printed only when the document charges it. */
  recargoPct: string;
  recargo: string;
  total: string;
  paymentTerms: string;
  notes: string;
  unreviewedVatNotice: string;
}

/**
 * THE words a factura prints, in Spanish whatever the screen's language —
 * "Base", "IVA", "N.I.F" and "Documento no fiscal…" are the terms the document
 * is required to use. One set, shared by admin and the rep panel, so the two
 * copies of the same document cannot drift.
 */
export const FACTURA_LABELS_ES: FacturaLabels = {
  albaranTitle: 'ALBARÁN',
  invoiceTitle: 'FACTURA',
  creditNoteTitle: 'FACTURA RECTIFICATIVA',
  date: 'FECHA',
  draftNumber: 'BORRADOR',
  orderRef: 'PEDIDO',
  taxId: 'N.I.F',
  phone: 'TELÉFONO',
  page: 'PÁG.',
  sellerPhone: 'TELÉF.',
  sellerTaxId: 'NIF',
  code: 'CÓDIGO',
  description: 'DESCRIPCIÓN',
  qty: 'UNID.',
  unitPrice: 'PRECIO',
  discount: 'DTO.',
  vatRate: 'IVA',
  lineTotal: 'IMPORTE',
  carriedIn: 'SUMA ANTERIOR',
  carriedOut: 'SUMA Y SIGUE',
  totalBase: 'TOTAL IMP.',
  base: 'BASE',
  ratePct: '%',
  vat: 'IVA',
  recargoPct: '% REC.',
  recargo: 'REC.',
  total: 'TOTAL',
  paymentTerms: 'Condiciones de pago',
  notes: 'Notas',
  unreviewedVatNotice: 'Tipo de IVA no revisado para este producto.',
};

type Line = Invoice['lines'][number];

// ─── Amounts without IVA ──────────────────────────────────

const cents = (v: string | null | undefined) => eurosToCents(v ?? '0');
/** Cents with IVA at `rate` → cents without, unrounded (facturaLineBases). */
const net = (c: number, rate: number) => (c * 100) / (100 + rate);

/**
 * Each line's amount WITHOUT IVA, in whole cents, adding up — rate by rate —
 * to the base the document's totals state, so the lines and the foot agree.
 *
 * Each starts as its exact value rounded down; the cents still owed to the
 * rate's stated base go one each to the lines with the largest remainders
 * (and any surplus comes off the smallest). No line moves more than a cent
 * from its exact value. A rate the totals do not list (an older document)
 * simply rounds each line.
 */
export function facturaLineBases(
  lines: ReadonlyArray<Pick<Line, 'gross' | 'rate_pct'>>,
  byRate: ReadonlyArray<{ rate_pct: number; base: string }>,
): number[] {
  const exact = lines.map((l) => net(cents(l.gross), l.rate_pct));
  const out = exact.map((x) => Math.floor(x + 1e-9));
  const target = new Map(byRate.map((g) => [g.rate_pct, cents(g.base)]));
  const rates = [...new Set(lines.map((l) => l.rate_pct))];
  for (const rate of rates) {
    const idx = lines.map((l, i) => (l.rate_pct === rate ? i : -1)).filter((i) => i >= 0);
    const want = target.get(rate);
    if (want === undefined) {
      for (const i of idx) out[i] = Math.round(exact[i]);
      continue;
    }
    let diff = want - idx.reduce((s, i) => s + out[i], 0);
    const byRemainder = [...idx].sort((a, b) => (exact[b] - out[b]) - (exact[a] - out[a]));
    for (let k = 0; diff > 0 && byRemainder.length > 0; k = (k + 1) % byRemainder.length, diff -= 1) {
      out[byRemainder[k]] += 1;
    }
    const smallest = [...byRemainder].reverse();
    for (let k = 0; diff < 0 && smallest.length > 0; k = (k + 1) % smallest.length, diff += 1) {
      out[smallest[k]] -= 1;
    }
  }
  return out;
}

// ─── Formatting (Spanish) ─────────────────────────────────

const num = (v: number, dp: number) =>
  new Intl.NumberFormat('es-ES', { minimumFractionDigits: dp, maximumFractionDigits: dp }).format(v);
/** Whole cents as euros: "4,18". */
const eur = (c: number) => num(c / 100, 2);
/** A unit amount: two decimals when it is a whole cent, four when it is not. */
const unitEur = (c: number) => (Math.abs(c - Math.round(c)) < 1e-6 ? eur(Math.round(c)) : num(c / 100, 4));

// ─── Pagination ───────────────────────────────────────────
//
// Budgets in ROW UNITS: one ordinary line is one unit — measured at 17px
// (10px type, 3px padding) in a rendered sheet, where about 46 fit under the
// header and strip. A description long enough to wrap takes two. The numbers
// are short of what fits on purpose — white space at the bottom is a
// document; a page that overruns is one html2canvas hands back taller than
// A4, which facturaPdf then squashes. Every page carries the header and
// strip; the last also the foot (bases, IVA, total, terms, notes), which
// costs about eight rows.
export const FACTURA_PAGE_ROWS = {
  /** Everything on one sheet. */
  single: 32,
  /** Page one of several. */
  first: 42,
  /** A middle sheet. */
  continuation: 42,
  /** The closing sheet, which also carries the foot. */
  last: 32,
} as const;

/**
 * How many rows a line takes: one per 40 characters of description. The
 * column is about 290px of 10px upper case — forty of the widest common
 * letter (X) fit on one line, measured; ordinary text fits more, so a line
 * is never counted short and a page never overruns.
 */
export const FACTURA_DESCRIPTION_CHARS = 40;
export function facturaRowWeight(l: Pick<Line, 'description'>): number {
  return Math.max(1, Math.ceil((l.description ?? '').length / FACTURA_DESCRIPTION_CHARS));
}

interface FacturaPageData {
  lines: Line[];
  isFirst: boolean;
  /** The foot — bases, IVA, the total — lands on the last page only. */
  showTotals: boolean;
}

/** Take lines off the front until `budget` row units are used up. */
function takeRows(remaining: Line[], budget: number): Line[] {
  const taken: Line[] = [];
  let used = 0;
  while (remaining.length > 0) {
    const next = facturaRowWeight(remaining[0]);
    // Always take at least one, or a single oversized line would loop forever.
    if (taken.length > 0 && used + next > budget) break;
    used += next;
    taken.push(remaining.shift()!);
  }
  return taken;
}

const load = (ls: Line[]) => ls.reduce((s, l) => s + facturaRowWeight(l), 0);

/**
 * How much of `left` to put on this page when what remains fits on this page
 * and the last together: an even split, but never so little that the last
 * page is left more than it can carry. A full page followed by a sheet with
 * one line on it reads like a mistake.
 */
const evenShare = (left: number, budget: number) =>
  Math.min(budget, Math.max(Math.ceil(left / 2), left - FACTURA_PAGE_ROWS.last));

export function paginateFacturaLines(lines: Line[]): FacturaPageData[] {
  const total = load(lines);
  if (total <= FACTURA_PAGE_ROWS.single) {
    return [{ lines, isFirst: true, showTotals: true }];
  }

  const pages: FacturaPageData[] = [];
  const remaining = lines.slice();
  const firstBudget = total <= FACTURA_PAGE_ROWS.first + FACTURA_PAGE_ROWS.last
    ? evenShare(total, FACTURA_PAGE_ROWS.first)
    : FACTURA_PAGE_ROWS.first;
  pages.push({ lines: takeRows(remaining, firstBudget), isFirst: true, showTotals: false });

  while (remaining.length > 0) {
    const left = load(remaining);
    if (left <= FACTURA_PAGE_ROWS.last) {
      pages.push({ lines: remaining.splice(0), isFirst: false, showTotals: true });
    } else if (left <= FACTURA_PAGE_ROWS.continuation + FACTURA_PAGE_ROWS.last) {
      pages.push({ lines: takeRows(remaining, evenShare(left, FACTURA_PAGE_ROWS.continuation)), isFirst: false, showTotals: false });
    } else {
      pages.push({ lines: takeRows(remaining, FACTURA_PAGE_ROWS.continuation), isFirst: false, showTotals: false });
    }
  }

  // Unreachable as the budgets stand. Kept because dropping the foot off a
  // factura is the one outcome that must not be possible.
  if (!pages[pages.length - 1].showTotals) {
    pages.push({ lines: [], isFirst: false, showTotals: true });
  }
  return pages;
}

// ─── Styles ───────────────────────────────────────────────

const INK = '#1A1A1A';
const MUTED = '#555555';
const GRID = '#5A5A5A';
const HEAD = '#D9D9D9';
const MONO = 'Consolas, "Courier New", monospace';

const pageStyle: CSSProperties = {
  width: 794,
  minHeight: 1123,
  background: '#FFFFFF',
  padding: '40px 40px 36px',
  boxSizing: 'border-box',
  fontFamily: 'Arial, Helvetica, sans-serif',
  color: INK,
  display: 'flex',
  flexDirection: 'column',
};
const cell: CSSProperties = { border: `1px solid ${GRID}`, padding: '5px 6px', fontSize: 10.5 };
const headCell: CSSProperties = {
  ...cell, background: HEAD, fontWeight: 700, fontSize: 9.5, letterSpacing: 0.3, textAlign: 'center',
};
const lineHead: CSSProperties = {
  background: HEAD, fontWeight: 700, fontSize: 9, letterSpacing: 0.3, padding: '5px 6px',
  borderTop: `1px solid ${GRID}`, borderBottom: `1px solid ${GRID}`, textAlign: 'left',
};
const lineCell: CSSProperties = { fontSize: 10, padding: '3px 6px', verticalAlign: 'top' };
const right: CSSProperties = { textAlign: 'right', whiteSpace: 'nowrap' };

const stacked = (rows: ReactNode[]) => rows.map((r, i) => <div key={i}>{r}</div>);

export default function FacturaDocument({
  invoice, labels,
}: { invoice: Invoice; labels: FacturaLabels }) {
  const seller = invoice.seller_snapshot;
  const buyer = invoice.buyer_snapshot;
  const isAlbaran = invoice.kind === 'albaran';
  // The title is the only thing an albarán does differently (2026-11-05).
  const title = invoice.kind === 'credit_note'
    ? labels.creditNoteTitle
    : (isAlbaran ? labels.albaranTitle : labels.invoiceTitle);
  const anyUnreviewed = invoice.lines.some((l) => l.vat_source === 'default');
  /**
   * FECHA is the issue date and the number box the document's number — both
   * given at ISSUE, never before: a number handed to a draft that is then
   * dropped leaves a gap in a series that may not have one, and printing the
   * "next" number could hand the same one to two documents. So a DRAFT shows
   * today's date (what it would carry if issued now) and BORRADOR where the
   * number goes — filled, and never mistakable for an issued factura (user,
   * 2026-11-04: "fecha should have the date… factura should have the number").
   */
  const isDraft = invoice.status === 'draft';
  const shortDate = (d: string | Date) =>
    new Date(d).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' });
  const issueDate = invoice.issue_date ? shortDate(invoice.issue_date) : (isDraft ? shortDate(new Date()) : '');
  const numberShown = invoice.invoice_number ?? (isDraft ? labels.draftNumber : '');
  const orderNumber = invoice.order?.order_number ?? invoice.parent_order?.order_number ?? '';
  // Recargo de equivalencia columns at the foot, when the document charges it
  // (2026-11-04) — base + IVA + recargo is then the total.
  const withRecargo = !!invoice.recargo_equivalencia || invoice.totals.recargo !== undefined;

  // The pages' running sums are the lines' amounts as printed — with IVA —
  // so SUMA ANTERIOR / Y SIGUE add up down the column (2026-11-05).
  const pages = paginateFacturaLines(invoice.lines);
  const pageSums = pages.map((p) => p.lines.reduce((s, l) => s + cents(l.gross), 0));

  const sellerLines = [
    seller.address,
    [seller.postcode, seller.city].filter(Boolean).join(' '),
    seller.province && seller.province !== seller.city ? seller.province : null,
    seller.phone ? `${labels.sellerPhone}: ${seller.phone}` : null,
    seller.email,
  ].filter(Boolean) as string[];
  const buyerLines = [
    buyer.address,
    [buyer.postcode, buyer.city].filter(Boolean).join(' '),
    buyer.province && buyer.province !== buyer.city ? buyer.province : null,
  ].filter(Boolean) as string[];

  const stripHeads = [labels.date, title, labels.orderRef, labels.taxId, labels.phone, labels.page];

  return (
    <>
      {pages.map((page, pageIndex) => {
        const carriedIn = pageSums.slice(0, pageIndex).reduce((s, x) => s + x, 0);
        const carriedOut = carriedIn + pageSums[pageIndex];
        // Nothing to say prints as nothing (user, 2026-11-04) — a customer
        // may have no NIF or phone. A "—" in a box reads as a value
        // somebody wrote.
        const stripValues = [issueDate, numberShown, orderNumber, buyer.tax_id ?? '', buyer.phone ?? '', `${pageIndex + 1}/${pages.length}`];

        return (
          <div key={pageIndex} className="invoice-page" style={pageStyle}>
            {/* Seller on the left, customer boxed on the right. */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 24, marginBottom: 18 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 6 }}>
                  {seller.legal_name || seller.name || ''}
                </div>
                {sellerLines.map((l, i) => (
                  <div key={i} style={{ fontSize: 10, lineHeight: 1.45, textTransform: 'uppercase' }}>{l}</div>
                ))}
                {seller.tax_id && (
                  <div style={{ fontSize: 10, marginTop: 6 }}>
                    {labels.sellerTaxId}: <strong style={{ fontSize: 12, marginLeft: 6 }}>{seller.tax_id}</strong>
                  </div>
                )}
              </div>
              <div style={{
                width: 300, minHeight: 104, border: `1.5px solid ${INK}`, borderRadius: 14,
                padding: '12px 16px', boxSizing: 'border-box', textTransform: 'uppercase',
              }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 14 }}>{buyer.name ?? ''}</div>
                {buyerLines.map((l, i) => (
                  <div key={i} style={{ fontSize: 10.5, lineHeight: 1.5 }}>{l}</div>
                ))}
              </div>
            </div>

            {/* The strip: which document, for whom, which sheet. */}
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 6 }}>
              <thead>
                <tr>{stripHeads.map((h, i) => <th key={i} style={headCell}>{h}</th>)}</tr>
              </thead>
              <tbody>
                <tr>
                  {stripValues.map((v, i) => (
                    <td key={i} style={{
                      ...cell, textAlign: 'center',
                      ...(i === 1 || i === 2 ? { fontFamily: MONO, fontSize: 10 } : {}),
                    }}>{v}</td>
                  ))}
                </tr>
              </tbody>
            </table>

            {/* What the earlier sheets came to, with IVA (as the lines print). */}
            <div style={{ height: 18, fontSize: 10, textAlign: 'right' }}>
              {pageIndex > 0 && (
                <>{labels.carriedIn}<span style={{ display: 'inline-block', minWidth: 80 }}>{eur(carriedIn)}</span></>
              )}
            </div>

            {page.lines.length > 0 && (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ ...lineHead, width: 72 }}>{labels.code}</th>
                    <th style={lineHead}>{labels.description}</th>
                    <th style={{ ...lineHead, ...right, width: 44 }}>{labels.qty}</th>
                    <th style={{ ...lineHead, ...right, width: 58 }}>{labels.unitPrice}</th>
                    <th style={{ ...lineHead, ...right, width: 50 }}>{labels.discount}</th>
                    <th style={{ ...lineHead, ...right, width: 40 }}>{labels.vatRate}</th>
                    <th style={{ ...lineHead, ...right, width: 64 }}>{labels.lineTotal}</th>
                  </tr>
                </thead>
                <tbody>
                  {page.lines.map((l, i) => {
                    const perUnitOff = l.discount && l.quantity > 0 ? cents(l.discount) / l.quantity : 0;
                    return (
                      <tr key={i}>
                        <td style={{ ...lineCell, fontSize: 9.5, whiteSpace: 'nowrap', overflow: 'hidden', maxWidth: 72 }}>{l.code ?? ''}</td>
                        <td style={{ ...lineCell, textTransform: 'uppercase' }}>{l.description}</td>
                        <td style={{ ...lineCell, ...right }}>{num(l.quantity, 2)}</td>
                        {/* With IVA, as charged: PRECIO − DTO. = IMPORTE. */}
                        <td style={{ ...lineCell, ...right }}>{unitEur(cents(l.unit_price))}</td>
                        <td style={{ ...lineCell, ...right }}>{perUnitOff > 0 ? unitEur(perUnitOff) : ''}</td>
                        <td style={{ ...lineCell, ...right }}>
                          {num(l.rate_pct, 2)}{l.vat_source === 'default' ? '*' : ''}
                        </td>
                        <td style={{ ...lineCell, ...right }}>{eur(cents(l.gross))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}

            {/* Carried to the next sheet. */}
            {!page.showTotals && (
              <div style={{ marginTop: 'auto', paddingTop: 12, fontSize: 10, textAlign: 'right' }}>
                {labels.carriedOut}<span style={{ display: 'inline-block', minWidth: 80 }}>{eur(carriedOut)}</span>
              </div>
            )}

            {/* The foot, on the last sheet: bases and IVA per rate, the total. */}
            {page.showTotals && (
              <div style={{ marginTop: 'auto', paddingTop: 16 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={headCell}>{labels.totalBase}</th>
                        <th style={headCell}>{labels.base}</th>
                        <th style={headCell}>{labels.ratePct}</th>
                        <th style={headCell}>{labels.vat}</th>
                        {withRecargo && (
                          <>
                            <th style={headCell}>{labels.recargoPct}</th>
                            <th style={headCell}>{labels.recargo}</th>
                          </>
                        )}
                        <th style={headCell}>{labels.total}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr style={{ height: 64 }}>
                        <td style={{ ...cell, ...right, verticalAlign: 'top' }}>{eur(cents(invoice.totals.base))}</td>
                        <td style={{ ...cell, ...right, verticalAlign: 'top' }}>
                          {stacked(invoice.totals.by_rate.map((g) => eur(cents(g.base))))}
                        </td>
                        <td style={{ ...cell, ...right, verticalAlign: 'top' }}>
                          {stacked(invoice.totals.by_rate.map((g) => num(g.rate_pct, 2)))}
                        </td>
                        <td style={{ ...cell, ...right, verticalAlign: 'top' }}>
                          {stacked(invoice.totals.by_rate.map((g) => eur(cents(g.vat))))}
                        </td>
                        {withRecargo && (
                          <>
                            <td style={{ ...cell, ...right, verticalAlign: 'top' }}>
                              {stacked(invoice.totals.by_rate.map((g) => num(g.recargo_pct ?? 0, 2)))}
                            </td>
                            <td style={{ ...cell, ...right, verticalAlign: 'top' }}>
                              {stacked(invoice.totals.by_rate.map((g) => eur(cents(g.recargo ?? '0'))))}
                            </td>
                          </>
                        )}
                        <td style={{ ...cell, ...right, width: withRecargo ? 120 : 150, fontSize: 19, fontWeight: 800, verticalAlign: 'middle' }}>
                          {eur(cents(invoice.totals.total ?? invoice.totals.gross))}€
                        </td>
                      </tr>
                    </tbody>
                  </table>

                {anyUnreviewed && (
                  <div style={{ fontSize: 8.5, color: MUTED, marginTop: 6 }}>* {labels.unreviewedVatNotice}</div>
                )}
                {invoice.payment_terms && (
                  <div style={{ fontSize: 10.5, fontWeight: 700, marginTop: 14, textTransform: 'uppercase', whiteSpace: 'pre-wrap' }}>
                    {invoice.payment_terms}
                  </div>
                )}
                {invoice.notes && (
                  <div style={{ fontSize: 10, color: MUTED, marginTop: 6, whiteSpace: 'pre-wrap' }}>
                    <strong style={{ color: INK }}>{labels.notes}: </strong>{invoice.notes}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
