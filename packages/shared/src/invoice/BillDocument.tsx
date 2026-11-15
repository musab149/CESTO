import type { CSSProperties } from 'react';
import type { OrderBill } from '../types';

/**
 * The Bill, on paper (2026-10-27): the customer's name, what they bought and
 * what it comes to. Nothing else about them, and nothing of Cesto's — the
 * company name that headed the page went on 2026-11-04 ("remove the
 * information related to cesto"), so the customer now heads it. The API
 * (lib/bill) sends nothing more, so the page has nothing else it could print.
 *
 * Inline styles only, for the reason InvoiceDocument gives: it is rasterised
 * off-screen by html2canvas, and must not depend on whichever app's
 * stylesheet happens to be loaded. Same A4 page, palette and page breaks as
 * that albarán, so the documents read as one family.
 */

export interface BillLabels {
  title: string;
  billedTo: string;
  product: string;
  qty: string;
  price: string;
  total: string;
  subtotal: string;
  delivery: string;
  /** Shown instead of an amount while no fee is set. */
  deliveryPending: string;
  /** Under the total while no fee is set. */
  pendingNote: string;
  /** The recargo de equivalencia row, printed only when one was charged. */
  recargo: string;
  continued: string;
  page: (current: number, total: number) => string;
}

const COLOR = {
  // Neutral, not our brand blue: the Bill carries nothing of Cesto's, its
  // colour included (user, 2026-11-04: "switch them to grey").
  accent: '#3F3F3F',
  ink: '#1A1A1A',
  gray: '#5C5C5C',
  muted: '#9E9E9E',
  border: '#E2E8F0',
  surfaceCream: '#FAFAF7',
  white: '#FFFFFF',
};
const FONT = "'DM Sans', ui-sans-serif, system-ui, sans-serif";
const FONT_MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace";

const locale = (lang: string) => (lang.startsWith('es') ? 'es-ES' : 'en-GB');
const money = (v: string | number, lang: string) =>
  new Intl.NumberFormat(locale(lang), { style: 'currency', currency: 'EUR' }).format(Number(v));
const day = (iso: string, lang: string) =>
  new Date(iso).toLocaleDateString(locale(lang), { day: '2-digit', month: 'long', year: 'numeric' });

// Page breaks decided before rendering, as in InvoiceDocument: a row cut in
// half by a PDF page boundary cannot be fixed after the raster.
const SINGLE_PAGE = 10;
const FIRST_PAGE = 14;
const MIDDLE_PAGE = 19;
const LAST_WITH_TOTALS = 12;

type Line = OrderBill['lines'][number];
interface Page { lines: Line[]; first: boolean; last: boolean }

function paginate(lines: Line[]): Page[] {
  if (lines.length <= SINGLE_PAGE) return [{ lines, first: true, last: true }];
  const rest = lines.slice();
  const pages: Page[] = [{ lines: rest.splice(0, FIRST_PAGE), first: true, last: false }];
  while (rest.length > 0) {
    if (rest.length <= LAST_WITH_TOTALS) pages.push({ lines: rest.splice(0), first: false, last: true });
    else pages.push({ lines: rest.splice(0, MIDDLE_PAGE), first: false, last: false });
  }
  return pages;
}

const pageStyle: CSSProperties = {
  width: 794, minHeight: 1123, padding: 56, boxSizing: 'border-box', display: 'flex', flexDirection: 'column',
  backgroundColor: COLOR.white, color: COLOR.ink, fontFamily: FONT,
};
const headStyle: CSSProperties = {
  display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 24,
  paddingBottom: 24, borderBottom: `2px solid ${COLOR.accent}`,
};
// Capitals like the albarán's "ALBARÁN"; the label itself stays "Bill" for the file name.
const titleStyle: CSSProperties = { fontWeight: 700, fontSize: 28, letterSpacing: '0.04em', textTransform: 'uppercase', color: COLOR.accent, margin: 0 };
const numberStyle: CSSProperties = { fontFamily: FONT_MONO, fontSize: 14, color: COLOR.ink, margin: '6px 0 0' };
const dateStyle: CSSProperties = { fontSize: 12, color: COLOR.gray, margin: '2px 0 0' };
const smallCapsStyle: CSSProperties = { fontSize: 11, fontWeight: 600, color: COLOR.gray, textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 };
const customerStyle: CSSProperties = { fontWeight: 700, fontSize: 22, lineHeight: 1.25, color: COLOR.ink, margin: '8px 0 0', maxWidth: 420 };
const thStyle: CSSProperties = { ...smallCapsStyle, padding: '10px 12px' };
const tdStyle: CSSProperties = { padding: 12, fontSize: 14 };
const totalRowStyle: CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 16, padding: '6px 0', fontSize: 14 };

export interface BillDocumentProps {
  bill: OrderBill;
  labels: BillLabels;
  /** 'en' or 'es': dates, money, and which product name is printed. */
  lang: string;
}

export default function BillDocument({ bill, labels, lang }: BillDocumentProps) {
  const pages = paginate(bill.lines);
  const en = lang.startsWith('en');

  return (
    <>
      {pages.map((page, index) => (
        <div key={index} className="invoice-page" style={pageStyle}>
          {page.first ? (
            <div style={headStyle}>
              <div>
                <p style={smallCapsStyle}>{labels.billedTo}</p>
                <p style={customerStyle}>{bill.customer}</p>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <p style={titleStyle}>{labels.title}</p>
                <p style={numberStyle}>{bill.order_number}</p>
                <p style={dateStyle}>{day(bill.date, lang)}</p>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 16, borderBottom: `1px solid ${COLOR.border}` }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>
                {labels.title} <span style={{ fontFamily: FONT_MONO }}>{bill.order_number}</span>
              </span>
              <span style={{ fontSize: 12, color: COLOR.gray }}>{labels.continued}</span>
            </div>
          )}

          <table style={{ width: '100%', marginTop: 24, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: COLOR.surfaceCream }}>
                <th style={{ ...thStyle, textAlign: 'left' }}>{labels.product}</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>{labels.qty}</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>{labels.price}</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>{labels.total}</th>
              </tr>
            </thead>
            <tbody>
              {page.lines.map((l, i) => {
                const name = (en ? l.name_en : null) ?? l.name_es;
                const size = (en ? l.variant_en : null) ?? l.variant_es;
                return (
                  <tr key={i} style={{ borderBottom: `1px solid ${COLOR.border}` }}>
                    <td style={tdStyle}>
                      <p style={{ margin: 0, color: COLOR.ink }}>{name}</p>
                      {size && <p style={{ margin: '2px 0 0', fontSize: 12, color: COLOR.muted }}>{size}</p>}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>{l.quantity}</td>
                    <td style={{ ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap', color: COLOR.gray }}>{money(l.unit_price, lang)}</td>
                    <td style={{ ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600 }}>{money(l.line_total, lang)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {page.last && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 24 }}>
              <div style={{ width: 280 }}>
                <div style={totalRowStyle}>
                  <span style={{ color: COLOR.gray }}>{labels.subtotal}</span>
                  <span>{money(bill.subtotal, lang)}</span>
                </div>
                <div style={totalRowStyle}>
                  <span style={{ color: COLOR.gray }}>{labels.delivery}</span>
                  <span style={bill.delivery_pending ? { color: COLOR.gray } : undefined}>
                    {bill.delivery_pending ? labels.deliveryPending : money(bill.delivery_fee, lang)}
                  </span>
                </div>
                {Number(bill.recargo ?? 0) > 0 && (
                  <div style={totalRowStyle}>
                    <span style={{ color: COLOR.gray }}>{labels.recargo}</span>
                    <span>{money(bill.recargo ?? '0', lang)}</span>
                  </div>
                )}
                <div style={{ ...totalRowStyle, borderTop: `2px solid ${COLOR.accent}`, paddingTop: 10, marginTop: 4, fontWeight: 700, fontSize: 18 }}>
                  <span>{labels.total}</span>
                  <span style={{ color: COLOR.accent }}>{money(bill.total, lang)}</span>
                </div>
                {bill.delivery_pending && (
                  <p style={{ fontSize: 11, color: COLOR.muted, margin: '8px 0 0', textAlign: 'right', lineHeight: 1.5 }}>{labels.pendingNote}</p>
                )}
              </div>
            </div>
          )}

          <p style={{ marginTop: 'auto', paddingTop: 24, fontSize: 10, color: COLOR.muted, textAlign: 'center' }}>
            {labels.page(index + 1, pages.length)}
          </p>
        </div>
      ))}
    </>
  );
}
