import { addVatCents, removeVatCents } from './tax';

/**
 * The price of one unit on a factura line being edited — always WITH IVA
 * (2026-11-04).
 *
 * How IVA works here: a product's price is its BASE, IVA is added on top when
 * it is sold, and every customer — shop and B2B — sees and pays the price
 * with IVA in it ("IVA incluido"). The factura says the same thing: its
 * prices are the ones the customer saw, with IVA in them, and its totals
 * break each rate down into base + IVA.
 *
 * So on a line:
 *   · the price with IVA is what is shown, typed and printed;
 *   · its base is read back out of it (exactly, for any price checkout made);
 *   · CHANGING THE RATE RE-ADDS IVA TO THE SAME BASE, as at product creation,
 *     so the price and the total follow the rate (user: "when I apply the iva
 *     then nothing changes in total");
 *   · putting the rate back gives back the price that was charged, to the
 *     cent — even one no whole-cent base produces (a 4.00 fee at 21 %);
 *   · TYPING a price keeps it as typed, and the base follows it.
 *
 * Only the document changes: never the product, never the order.
 */

/** The price as charged, kept so going back to it is exact. */
export interface ChargedPrice {
  priceCents: number;
  baseCents: number;
  ratePct: number;
}

/** The base inside a price with IVA at `ratePct`, in cents. */
export function baseOfPriceCents(priceCents: number, ratePct: number): number {
  return removeVatCents(priceCents, ratePct);
}

/**
 * The price with IVA once the rate is `ratePct`: the base plus IVA, half up
 * per unit as checkout adds it — or, back at the charged base and rate, the
 * charged price itself.
 */
export function priceAtRate(baseCents: number, ratePct: number, charged?: ChargedPrice | null): number {
  if (charged && charged.ratePct === ratePct && charged.baseCents === baseCents) return charged.priceCents;
  return addVatCents(baseCents, ratePct);
}
