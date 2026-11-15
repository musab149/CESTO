import {
  addVatCents, effectiveVatCategory, eurosToCents, VAT_RATES, type VatCategory,
} from './tax';

/**
 * What a discounted basket line costs, for the screen that is building it.
 *
 * The server's answer lives in `packages/api/src/lib/orderTotals.ts`
 * (`lineTotal`) and is Decimal; this is the same rule in the number
 * arithmetic a preview can afford, because nothing here is ever written —
 * createOrder and editOrder recompute from the catalogue price and their own
 * Decimals. The two are kept in step by tests/orderLinePreview.test.ts, which
 * runs the same table of cases this file and that one must agree on.
 *
 * It exists because the order builders — admin's and the rep's — showed the
 * GROSS. Somebody took EUR 5 off a line and the line total, the subtotal, the
 * IVA split and the total all carried on as though they had not, so the only
 * way to see the price you had just agreed was to place the order and open it
 * again. A discount field whose figure does not move anything is worse than no
 * field: it looks like it did not take.
 */

/**
 * Euros off a line, read from the string somebody is typing.
 *
 * Blank, "0", a lone separator and a half-written "1." are all no discount
 * rather than NaN. One parser for the preview AND for the `set_discount`
 * operation, so what the screen shows and what it sends cannot read the same
 * keystrokes differently.
 */
export function discountEuros(raw: string | null | undefined): number {
  const n = Number((raw ?? '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export interface PreviewLine {
  unitPrice: number;
  quantity: number;
  /** Euros off the WHOLE line, as typed — the older flat figure. See discountEuros. */
  discount?: string;
  /**
   * Euros off ONE unit, as typed (2026-10-25). When given it decides the line
   * — the flat `discount` is ignored — exactly as the server's
   * lineDiscountFromUnit does: the figure times the quantity, to the cent.
   */
  unitDiscount?: string;
}

/**
 * CLAMPED AT ZERO, which is not defensive — a discount bigger than the line
 * happens honestly: take EUR 5 off a EUR 12 line, then drop the quantity to
 * one. A negative line would flow into the subtotal and the IVA split, and
 * the server clamps it too, so a preview that did not would disagree with the
 * order it is about to create.
 */
export function previewLineTotal(line: PreviewLine): number {
  const gross = line.unitPrice * line.quantity;
  // In cents for the per-unit case, so 0.1 × 3 is 0.30 and not 0.30000000000000004.
  const off = line.unitDiscount !== undefined
    ? (Math.round(discountEuros(line.unitDiscount) * 100) * line.quantity) / 100
    : discountEuros(line.discount);
  return off >= gross ? 0 : gross - off;
}

/**
 * An order line's euros off one unit, as the text a builder's field starts
 * with: its own `unit_discount`, or — for a line discounted before discounts
 * were per unit — its flat figure over its quantity, to the cent (what the
 * server reads it as the first time the line changes). '' for none.
 */
export function unitDiscountText(item: {
  unit_discount?: number | string | null;
  discount_amount?: number | string | null;
  quantity: number;
}): string {
  const unit = Number(item.unit_discount ?? 0);
  if (unit > 0) return String(unit);
  const flat = Number(item.discount_amount ?? 0);
  if (flat > 0 && item.quantity > 0) return String(Math.round((flat * 100) / item.quantity) / 100);
  return '';
}

/** The band a recorded rate belongs to. A rate no band has reads as 0 %. */
function bandForRate(rate: number): VatCategory {
  const hit = (Object.keys(VAT_RATES) as VatCategory[]).find((band) => VAT_RATES[band] === rate);
  return hit ?? 'zero';
}

/**
 * The IVA band an order line is previewed at — the one its documents use
 * (the API's buildInvoiceLines):
 *
 *   1. the rate the line was charged with, which every line made since
 *      2026-11-01 records (`tax_rate_pct`), so a band changed on the product
 *      afterwards does not re-split what this order charged;
 *   2. else the product's band as it stands, 0 % until somebody chose one.
 *
 * The line's `vat_category` column is never written, so it cannot come first.
 */
export function lineVatCategory(item: {
  tax_rate_pct?: number | null;
  vat_category?: VatCategory | null;
  product?: { vat_category?: VatCategory | null; vat_category_reviewed?: boolean | null } | null;
}): VatCategory {
  if (item.tax_rate_pct != null) return bandForRate(item.tax_rate_pct);
  return item.vat_category ?? effectiveVatCategory(item.product);
}

/**
 * A stored base price, as typed in admin without IVA, as a customer pays it:
 * plus its band's IVA, to the cent. The API's withVat on the same lib/tax
 * rounding, so a builder that prices a size itself shows the charge.
 */
export function priceWithVat(base: number | string, band: VatCategory): number {
  return addVatCents(eurosToCents(base), VAT_RATES[band]) / 100;
}

/** The basket, net of its discounts — what the server will store as subtotal. */
export function previewSubtotal(lines: PreviewLine[]): number {
  return lines.reduce((sum, l) => sum + previewLineTotal(l), 0);
}
