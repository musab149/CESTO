import type { CSSProperties } from 'react';

/**
 * Shape this component needs from an Order — a subset of the admin/partner
 * `GET .../orders/:id` response. Kept local rather than importing the full
 * `Order` type because several fields here are optional/loosely-typed on
 * the wire and this component only ever reads, never writes.
 */
export interface InvoiceOrder {
  id: string;
  order_number: string;
  created_at: string;
  payment_method: string;
  subtotal: number;
  delivery_fee: number;
  total: number;
  user?: { name: string; phone: string | null; email: string | null } | null;
  address_snapshot?: {
    contact_name?: string;
    contact_phone?: string;
    street_line_1?: string;
    street_line_2?: string;
    postcode?: string;
    city?: string;
    province?: string;
  } | null;
  items: Array<{
    id: string;
    product_snapshot: { name_es?: string; name_en?: string; variant_name_es?: string; variant_name_en?: string };
    quantity: number;
    unit_price: number;
    line_total: number;
  }>;
}

export interface InvoiceSettings {
  storeName: string;
  address: string;
  contactEmail: string;
  contactPhone: string;
}

/**
 * All display strings, supplied by the caller rather than looked up via a
 * hook — admin (react-i18next, EN/ES) and the partner web app (no i18n
 * setup at all) both render this component, so it can't assume any
 * particular translation library is installed/initialized.
 */
export interface InvoiceLabels {
  title: string;
  from: string;
  to: string;
  product: string;
  qty: string;
  price: string;
  total: string;
  subtotal: string;
  shipping: string;
  free: string;
  payment: string;
  paymentMethods: Record<string, string>;
  continued: string;
  page: (current: number, total: number) => string;
}

// ─── Inline styles only, deliberately ──────────────────────────────────
// This document is rasterized off-screen by html2canvas for a PDF export.
// It must render identically regardless of whether the host app's Tailwind
// bundle happens to be loaded/warm/un-purged at capture time — a stale or
// partially-loaded stylesheet previously left elements completely
// unstyled on at least one client's machine (a 1042×1000px logo rendered
// at native size instead of 40×40, spacing collapsed, etc). Every visual
// property here is a literal inline style so there is no external CSS
// dependency, and no Tailwind class (which could vary between the two
// host apps' compiled bundles) is used anywhere in this file.
const COLOR = {
  brand: '#054EE8',
  ink: '#1A1A1A',
  gray: '#5C5C5C',
  muted: '#9E9E9E',
  border: '#E2E8F0',
  surfaceCream: '#FAFAF7',
  white: '#FFFFFF',
};

const FONT_DISPLAY = "'DM Sans', ui-sans-serif, system-ui, sans-serif";
const FONT_MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace";

function localeFor(lang: string): string {
  return lang.startsWith('es') ? 'es-ES' : 'en-GB';
}

function formatCurrency(amount: number, lang: string): string {
  return new Intl.NumberFormat(localeFor(lang), { style: 'currency', currency: 'EUR' }).format(amount);
}

function formatDate(iso: string, lang: string): string {
  return new Date(iso).toLocaleDateString(localeFor(lang), { day: '2-digit', month: 'long', year: 'numeric' });
}

// ─── Pagination ─────────────────────────────────────────
// html2canvas rasterizes whatever we hand it; the only way to avoid cutting
// a table row across a PDF page boundary is to decide page breaks *before*
// rendering and emit one `.invoice-page` block per page. Row height is
// fixed/assumed (not DOM-measured) so this can run in a single pass.
const MAX_ITEMS_SINGLE_PAGE = 8; // items + totals + footer all fit on page 1
const FIRST_PAGE_OVERFLOW_ITEMS = 12; // page 1 when there's more to come (no totals)
const CONT_PAGE_ITEMS = 18; // continuation page, not the last one
const LAST_CHUNK_MAX_WITH_TOTALS = 10; // last remaining chunk still gets totals on the same page

interface InvoicePage {
  items: InvoiceOrder['items'];
  isFirst: boolean;
  isLast: boolean;
  showTotals: boolean;
}

function paginateItems(items: InvoiceOrder['items']): InvoicePage[] {
  if (items.length <= MAX_ITEMS_SINGLE_PAGE) {
    return [{ items, isFirst: true, isLast: true, showTotals: true }];
  }

  const pages: InvoicePage[] = [];
  const remaining = items.slice();

  pages.push({ items: remaining.splice(0, FIRST_PAGE_OVERFLOW_ITEMS), isFirst: true, isLast: false, showTotals: false });

  while (remaining.length > 0) {
    if (remaining.length <= LAST_CHUNK_MAX_WITH_TOTALS) {
      pages.push({ items: remaining.splice(0), isFirst: false, isLast: true, showTotals: true });
    } else {
      pages.push({ items: remaining.splice(0, CONT_PAGE_ITEMS), isFirst: false, isLast: false, showTotals: false });
    }
  }

  return pages;
}

// ─── Style objects ──────────────────────────────────────

const pageStyle: CSSProperties = {
  width: 794,
  minHeight: 1123,
  padding: 48,
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  backgroundColor: COLOR.white,
  color: COLOR.ink,
  fontFamily: FONT_DISPLAY,
};

const headerRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  paddingBottom: 24,
  borderBottom: `2px solid ${COLOR.brand}`,
};

const logoBlockStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10 };
const logoImgStyle: CSSProperties = { width: 40, height: 40, borderRadius: 8, objectFit: 'cover', display: 'block' };
const brandNameStyle: CSSProperties = { fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 24, color: COLOR.ink, margin: 0 };

const invoiceTitleStyle: CSSProperties = { fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 24, color: COLOR.brand, letterSpacing: '0.02em', margin: 0 };
const orderNumberStyle: CSSProperties = { fontFamily: FONT_MONO, fontSize: 14, color: COLOR.ink, margin: '4px 0 0' };
const issueDateStyle: CSSProperties = { fontFamily: FONT_DISPLAY, fontSize: 12, color: COLOR.gray, margin: '2px 0 0' };

const partiesRowStyle: CSSProperties = { display: 'flex', gap: 32, marginTop: 24 };
const partyColStyle: CSSProperties = { flex: 1 };
const partyLabelStyle: CSSProperties = { fontFamily: FONT_DISPLAY, fontSize: 11, fontWeight: 600, color: COLOR.gray, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 8px' };
const partyNameStyle: CSSProperties = { fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 14, color: COLOR.ink, margin: 0 };
const partyLineStyle: CSSProperties = { fontFamily: FONT_DISPLAY, fontSize: 14, color: COLOR.gray, margin: '2px 0 0', lineHeight: 1.6 };

const continuationHeaderStyle: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 16, borderBottom: `1px solid ${COLOR.border}` };

const tableStyle: CSSProperties = { width: '100%', marginTop: 24, borderCollapse: 'collapse' };
const theadRowStyle: CSSProperties = { backgroundColor: COLOR.surfaceCream };
const thBaseStyle: CSSProperties = { fontFamily: FONT_DISPLAY, fontSize: 11, fontWeight: 600, color: COLOR.gray, textTransform: 'uppercase', letterSpacing: '0.05em', padding: '10px 12px' };
const tbodyRowStyle: CSSProperties = { borderBottom: `1px solid ${COLOR.border}` };
const tdBaseStyle: CSSProperties = { padding: 12 };
const productNameStyle: CSSProperties = { fontFamily: FONT_DISPLAY, fontSize: 14, color: COLOR.ink, margin: 0 };
const variantNameStyle: CSSProperties = { fontFamily: FONT_DISPLAY, fontSize: 12, color: COLOR.muted, margin: '2px 0 0' };

const totalsWrapStyle: CSSProperties = { display: 'flex', justifyContent: 'flex-end', marginTop: 24 };
const totalsBoxStyle: CSSProperties = { width: 256 };
const totalsRowStyle: CSSProperties = { display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 14, fontFamily: FONT_DISPLAY };
const totalsFinalRowStyle: CSSProperties = { ...totalsRowStyle, borderTop: `2px solid ${COLOR.brand}`, paddingTop: 10, marginTop: 4, fontWeight: 700, fontSize: 16 };
const paymentLineStyle: CSSProperties = { fontFamily: FONT_DISPLAY, fontSize: 11, color: COLOR.muted, marginTop: 8, textAlign: 'right' };

const footerStyle: CSSProperties = { marginTop: 'auto', paddingTop: 24, borderTop: `1px solid ${COLOR.border}` };
const footerTextStyle: CSSProperties = { fontFamily: FONT_DISPLAY, fontSize: 12, color: COLOR.muted, lineHeight: 1.6, margin: 0 };

const pageNumberStyle: CSSProperties = { fontFamily: FONT_DISPLAY, fontSize: 10, color: COLOR.muted, textAlign: 'center', marginTop: 16 };

export interface InvoiceDocumentProps {
  order: InvoiceOrder;
  settings: InvoiceSettings;
  labels: InvoiceLabels;
  /** BCP-47-ish language tag, e.g. 'en' or 'es'. Drives date/currency
   *  locale and which product-snapshot name field (name_en vs name_es)
   *  is shown. */
  lang: string;
  /** Absolute or root-relative URL to the brand mark shown in the header.
   *  Defaults to the admin/web public path; pass a different value if the
   *  host app serves it from elsewhere. */
  logoSrc?: string;
}

export default function InvoiceDocument({ order, settings, labels, lang, logoSrc = '/cesto-icon.png' }: InvoiceDocumentProps) {
  const pages = paginateItems(order.items ?? []);
  const buyerName = order.user?.name ?? order.address_snapshot?.contact_name ?? '—';
  const buyerPhone = order.address_snapshot?.contact_phone ?? order.user?.phone ?? '—';
  const buyerEmail = order.user?.email ?? '';
  const addr = order.address_snapshot;
  const paymentLabel = labels.paymentMethods[order.payment_method] ?? order.payment_method;

  return (
    <>
      {pages.map((page, pageIndex) => (
        <div key={pageIndex} className="invoice-page" style={pageStyle}>
          {page.isFirst ? (
            <>
              {/* Header */}
              <div style={headerRowStyle}>
                <div style={logoBlockStyle}>
                  <img src={logoSrc} alt="Cesto Shop" style={logoImgStyle} draggable={false} />
                  <span style={brandNameStyle}>Cesto Shop</span>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={invoiceTitleStyle}>{labels.title}</p>
                  <p style={orderNumberStyle}>{order.order_number}</p>
                  <p style={issueDateStyle}>{formatDate(order.created_at, lang)}</p>
                </div>
              </div>

              {/* Seller / buyer */}
              <div style={partiesRowStyle}>
                <div style={partyColStyle}>
                  <p style={partyLabelStyle}>{labels.from}</p>
                  <p style={partyNameStyle}>{settings.storeName || 'Cesto Shop'}</p>
                  {settings.address && <p style={partyLineStyle}>{settings.address}</p>}
                  {settings.contactEmail && <p style={partyLineStyle}>{settings.contactEmail}</p>}
                  {settings.contactPhone && <p style={partyLineStyle}>{settings.contactPhone}</p>}
                </div>
                <div style={partyColStyle}>
                  <p style={partyLabelStyle}>{labels.to}</p>
                  <p style={partyNameStyle}>{buyerName}</p>
                  {addr ? (
                    <p style={partyLineStyle}>
                      {addr.street_line_1}
                      {addr.street_line_2 && <>, {addr.street_line_2}</>}
                      <br />
                      {addr.postcode} {addr.city}{addr.province && <>, {addr.province}</>}
                    </p>
                  ) : null}
                  <p style={partyLineStyle}>{buyerPhone}</p>
                  {buyerEmail && <p style={partyLineStyle}>{buyerEmail}</p>}
                </div>
              </div>
            </>
          ) : (
            <div style={continuationHeaderStyle}>
              <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 14, color: COLOR.ink }}>
                {labels.title} <span style={{ fontFamily: FONT_MONO }}>{order.order_number}</span>
              </span>
              <span style={{ fontFamily: FONT_DISPLAY, fontSize: 12, color: COLOR.gray }}>{labels.continued}</span>
            </div>
          )}

          {/* Items table */}
          <table style={tableStyle}>
            <thead>
              <tr style={theadRowStyle}>
                <th style={{ ...thBaseStyle, textAlign: 'left' }}>{labels.product}</th>
                <th style={{ ...thBaseStyle, textAlign: 'center' }}>{labels.qty}</th>
                <th style={{ ...thBaseStyle, textAlign: 'right' }}>{labels.price}</th>
                <th style={{ ...thBaseStyle, textAlign: 'right' }}>{labels.total}</th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((item) => {
                const name = (lang.startsWith('en') ? item.product_snapshot?.name_en : item.product_snapshot?.name_es)
                  ?? item.product_snapshot?.name_es ?? '—';
                const variantName = (lang.startsWith('en') ? item.product_snapshot?.variant_name_en : item.product_snapshot?.variant_name_es)
                  ?? item.product_snapshot?.variant_name_es;
                return (
                  <tr key={item.id} style={tbodyRowStyle}>
                    <td style={tdBaseStyle}>
                      <p style={productNameStyle}>{name}</p>
                      {variantName && <p style={variantNameStyle}>{variantName}</p>}
                    </td>
                    <td style={{ ...tdBaseStyle, textAlign: 'center', fontFamily: FONT_DISPLAY, fontSize: 14, color: COLOR.ink }}>{item.quantity}</td>
                    <td style={{ ...tdBaseStyle, textAlign: 'right', whiteSpace: 'nowrap', fontFamily: FONT_DISPLAY, fontSize: 14, color: COLOR.gray }}>
                      {formatCurrency(Number(item.unit_price), lang)}
                    </td>
                    <td style={{ ...tdBaseStyle, textAlign: 'right', whiteSpace: 'nowrap', fontFamily: FONT_DISPLAY, fontSize: 14, fontWeight: 600, color: COLOR.ink }}>
                      {formatCurrency(Number(item.line_total), lang)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {page.showTotals && (
            <div style={totalsWrapStyle}>
              <div style={totalsBoxStyle}>
                <div style={totalsRowStyle}>
                  <span style={{ color: COLOR.gray }}>{labels.subtotal}</span>
                  <span style={{ color: COLOR.ink }}>{formatCurrency(Number(order.subtotal), lang)}</span>
                </div>
                <div style={totalsRowStyle}>
                  <span style={{ color: COLOR.gray }}>{labels.shipping}</span>
                  <span style={{ color: COLOR.ink }}>
                    {Number(order.delivery_fee) === 0 ? labels.free : formatCurrency(Number(order.delivery_fee), lang)}
                  </span>
                </div>
                <div style={totalsFinalRowStyle}>
                  <span style={{ color: COLOR.ink }}>{labels.total}</span>
                  <span style={{ color: COLOR.brand }}>{formatCurrency(Number(order.total), lang)}</span>
                </div>
                <p style={paymentLineStyle}>{labels.payment}: {paymentLabel}</p>
              </div>
            </div>
          )}

          {page.isLast && (
            <div style={footerStyle}>
              <p style={footerTextStyle}>
                {[settings.contactEmail, settings.contactPhone].filter(Boolean).join(' · ')}
              </p>
            </div>
          )}

          <p style={pageNumberStyle}>{labels.page(pageIndex + 1, pages.length)}</p>
        </div>
      ))}
    </>
  );
}
