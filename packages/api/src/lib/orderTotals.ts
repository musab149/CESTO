import { Prisma } from '@prisma/client';
import { computeTaxBreakdown, eurosToCents, centsToEuros, recargoCents, rateForCategory } from './tax';

/**
 * What an order's money columns should be, given its lines and its fee.
 *
 * The arithmetic is trivial; the reason it lives here is that it was already
 * written out four times — the checkout quote, the checkout itself, editOrder
 * Pass 4, and a client-side preview in EditOrderModal — and a fifth copy in
 * the admin order builder is how these drift apart for real.
 *
 * editOrder.ts now shares the per-line arithmetic (its own lineTotalFor
 * delegates here), because discounts can be set at CREATION as of
 * 2026-10-10 and a line discounted on the way in must cost exactly what the
 * same line costs after an edit. The checkout and its quote price lines here
 * too since 2026-10-25, when a customer's agreed per-unit discounts started
 * applying to their own orders (lib/customerDiscounts).
 *
 * Decimal throughout, never number. A cent lost to float rounding here is a
 * cent that does not reconcile against what the customer was shown.
 */
export interface OrderLineForTotals {
  unit_price: Prisma.Decimal;
  quantity: number;
  /**
   * Euros off the whole line — never a percentage. Since 2026-10-25 a
   * discount is agreed PER UNIT and this is that times the quantity (see
   * lineDiscountFromUnit); older lines carry a flat figure. Null or absent
   * means no discount, which is NOT the same as zero: the edit log keeps
   * "never discounted" and "discounted by nothing" apart.
   */
  discount_amount?: Prisma.Decimal | null;
  /** The IVA rate the line is charged at — what its recargo follows. */
  tax_rate_pct?: number | null;
}

export interface OrderTotals {
  subtotal: Prisma.Decimal;
  delivery_fee: Prisma.Decimal;
  /** Recargo de equivalencia; 0 for a customer not under the regime. */
  recargo: Prisma.Decimal;
  total: Prisma.Decimal;
}

/** The delivery fee is taxed at the general rate — lib/invoicing's fee line. */
const DELIVERY_RATE = rateForCategory('general');

/**
 * RECARGO DE EQUIVALENCIA on a basket (2026-11-04): rate by rate, on the
 * same taxable base as IVA — the base backed out of what the lines charge,
 * exactly as the factura's foot does it (computeTaxBreakdown), with the
 * delivery fee as a line at the general rate. So the recargo charged here is
 * the recargo the order's factura states, to the cent.
 *
 * A line with no recorded rate (only lines from before 2026-11-01, which
 * never belong to an order under the regime) counts as 0 %.
 */
export function recargoFor(
  lines: ReadonlyArray<{ line_total: Prisma.Decimal; tax_rate_pct?: number | null }>,
  deliveryFee: Prisma.Decimal,
): Prisma.Decimal {
  const b = computeTaxBreakdown([
    ...lines.map((l) => ({ grossCents: eurosToCents(l.line_total.toFixed(2)), rate_pct: l.tax_rate_pct ?? 0 })),
    ...(deliveryFee.gt(0) ? [{ grossCents: eurosToCents(deliveryFee.toFixed(2)), rate_pct: DELIVERY_RATE }] : []),
  ]);
  return new Prisma.Decimal(centsToEuros(b.groups.reduce((s, g) => s + recargoCents(g.base_cents, g.rate_pct), 0)));
}

/**
 * What one line costs, after its discount.
 *
 * CLAMPED AT ZERO, and that is not defensive — a discount larger than the
 * line happens honestly: take €5 off a €12 line, then drop the quantity to
 * one. Refusing the quantity change would be the wrong answer, and a negative
 * line would flow straight into the subtotal and the invoice VAT.
 *
 * This is the same rule editOrder has always applied to an edited line; it
 * lives here now so a line created with a discount and the same line edited
 * afterwards cannot disagree about what it costs.
 */
export function lineTotal(line: OrderLineForTotals): Prisma.Decimal {
  const gross = line.unit_price.mul(line.quantity);
  const discount = line.discount_amount;
  if (!discount || discount.lte(0)) return gross;
  return discount.gte(gross) ? new Prisma.Decimal(0) : gross.minus(discount);
}

/**
 * A per-unit discount as the line's flat `discount_amount`: euros off one
 * unit times the quantity (2026-10-25 — "a €4 product with €2 off costs that
 * customer €2"). Null for no discount, which `lineTotal` reads as none.
 *
 * Exact: a two-decimal amount times a whole quantity has no rounding to do,
 * so a line built here and the same line edited later agree to the cent.
 */
export function lineDiscountFromUnit(
  unit: Prisma.Decimal | null | undefined,
  quantity: number,
): Prisma.Decimal | null {
  if (!unit || unit.lte(0)) return null;
  return unit.mul(quantity);
}

/**
 * A line's euros off ONE unit.
 *
 * Its own `unit_discount` when it has one. A line discounted before per-unit
 * discounts existed has only a flat figure for the whole line; it is read as
 * that figure over the quantity, to the cent, so the first change to the line
 * (a quantity, say) carries the same discount per unit rather than a fixed
 * sum. Nothing rewrites such a line until something about it changes.
 */
export function unitDiscountOf(item: {
  unit_discount?: Prisma.Decimal | null;
  discount_amount?: Prisma.Decimal | null;
  quantity: number;
}): Prisma.Decimal | null {
  if (item.unit_discount && item.unit_discount.gt(0)) return item.unit_discount;
  if (item.discount_amount && item.discount_amount.gt(0) && item.quantity > 0) {
    return item.discount_amount.div(item.quantity).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  }
  return null;
}

export function computeOrderTotals(
  lines: OrderLineForTotals[],
  deliveryFee: Prisma.Decimal,
  /** The customer is under recargo de equivalencia: charge it. */
  opts: { recargo?: boolean } = {},
): OrderTotals {
  const subtotal = lines.reduce(
    (sum, l) => sum.plus(lineTotal(l)),
    new Prisma.Decimal(0),
  );
  const recargo = opts.recargo
    ? recargoFor(lines.map((l) => ({ line_total: lineTotal(l), tax_rate_pct: l.tax_rate_pct })), deliveryFee)
    : new Prisma.Decimal(0);
  return { subtotal, delivery_fee: deliveryFee, recargo, total: subtotal.plus(deliveryFee).plus(recargo) };
}

/**
 * The snapshot an OrderItem keeps of the product as it was when ordered.
 *
 * Extracted from editOrder.ts, which had the only copy. The shape matters:
 * order history and every future invoice read it, so a field quietly added on
 * one path and not the other produces orders that render differently for no
 * reason anyone can see.
 */
export function buildProductSnapshot(variant: {
  product: { id: string; name_es: string; name_en: string; images?: { url: string }[] };
  id: string;
  name_es: string;
  name_en: string;
}): Prisma.InputJsonValue {
  return {
    product_id: variant.product.id,
    variant_id: variant.id,
    name_es: variant.product.name_es,
    name_en: variant.product.name_en,
    variant_name_es: variant.name_es,
    variant_name_en: variant.name_en,
    image_url: variant.product.images?.[0]?.url ?? null,
  };
}
