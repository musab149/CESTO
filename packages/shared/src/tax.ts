/**
 * IVA: added to the prices admin types, and backed out of what was charged.
 *
 * `schema.prisma` has named this file the source of truth for tax rates since
 * the VatCategory enum was added. Nothing reads Order.tax_breakdown or
 * Order.tax_total, so every invoice number below is derived rather than read.
 *
 * BOTH DIRECTIONS, ONE EACH WAY (user, 2026-11-01: the B2C and B2B prices
 * entered in admin "are the base prices and they do not include iva... Once
 * we select the iva then it will be added to the product price"):
 *
 *   - a stored price is the BASE. What a customer is shown and charged is
 *     that base plus its product's IVA, to the cent: addVatCents. Shown
 *     including IVA, as terms-and-conditions.md §4 says.
 *   - what was charged is then the authoritative figure, and anything that
 *     splits it into base and IVA backs the IVA out of it per rate:
 *     computeTaxBreakdown. Never re-adding tax on top of a charged price,
 *     which would bill the customer twice.
 *
 * INTEGER CENTS, not floats and not Decimal. This has to run in the API
 * (which speaks Prisma.Decimal) and in two browser previews (which speak
 * number), and two implementations of a tax rule drift. Cents are exact in
 * JS up to 2^53 — about 90 trillion euros — so one implementation serves
 * both and the API converts at the boundary.
 */

export type VatCategory = 'zero' | 'super_reduced' | 'reduced' | 'general';

/** Spanish IVA rates. Confirm with an asesor before issuing anything real. */
export const VAT_RATES: Record<VatCategory, number> = {
  zero: 0,
  super_reduced: 4,
  reduced: 10,
  general: 21,
};

/**
 * The band a product's prices actually carry: the one somebody chose, or 0 %
 * until somebody does (the user's default, 2026-11-01).
 *
 * Read off `vat_category_reviewed` rather than trusting the category alone,
 * because every product from before 0 % existed sits on a `reduced` nobody
 * picked. Gating on the flag means those keep their price, with no migration
 * rewriting rows under an API that cannot read the new value yet. A payload
 * that does not carry the flag is taken at its category.
 */
export function effectiveVatCategory(product: {
  vat_category?: VatCategory | null;
  vat_category_reviewed?: boolean | null;
} | null | undefined): VatCategory {
  if (!product || product.vat_category_reviewed === false) return 'zero';
  return product.vat_category ?? 'zero';
}

/**
 * A base price in cents with IVA added, in cents: half up, as everywhere else
 * here. Integer arithmetic until the single division, whose only exact-half
 * results (x.5) are exactly representable, so the rounding never wobbles.
 */
export function addVatCents(netCents: number, ratePct: number): number {
  return roundHalfUp((netCents * (100 + ratePct)) / 100);
}

/**
 * The base a price WITH IVA was made from, in cents — the inverse of
 * addVatCents. Exact for every price addVatCents produced: each cent of base
 * adds at least one cent of price, so rounding back lands on the same base.
 * For a document that keeps the base and lets the rate move (factura editor,
 * 2026-11-04): what changes with the rate is the IVA, never the base.
 */
export function removeVatCents(grossCents: number, ratePct: number): number {
  return roundHalfUp((grossCents * 100) / (100 + ratePct));
}

/**
 * RECARGO DE EQUIVALENCIA (Ley 37/1992 arts. 154–163; user 2026-11-04): what
 * a retailer under the regime pays on top of IVA, ON THE SAME TAXABLE BASE —
 * never on the IVA. Per IVA rate, in basis points (5,2 % = 520). A rate not
 * listed carries none — 0 % IVA carries no surcharge.
 */
export const RECARGO_BASIS_POINTS: Readonly<Record<number, number>> = { 0: 0, 4: 50, 10: 140, 21: 520 };

export function recargoBasisPoints(ivaRatePct: number): number {
  return RECARGO_BASIS_POINTS[ivaRatePct] ?? 0;
}

/** The recargo on a taxable base in cents, at the surcharge for that IVA rate, half up. */
export function recargoCents(baseCents: number, ivaRatePct: number): number {
  return roundHalfUp((baseCents * recargoBasisPoints(ivaRatePct)) / 10000);
}

export interface TaxLineInput {
  /** VAT-INCLUSIVE line total, in cents. */
  grossCents: number;
  rate_pct: number;
}

export interface TaxGroup {
  rate_pct: number;
  /** Taxable base for this rate, in cents. */
  base_cents: number;
  vat_cents: number;
  gross_cents: number;
}

export interface TaxBreakdown {
  groups: TaxGroup[];
  taxable_base_cents: number;
  vat_total_cents: number;
  gross_total_cents: number;
}

function roundHalfUp(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value));
}

/**
 * Group by rate, then back the VAT out of each group's gross.
 *
 * The rounding rule is the part that is easy to get wrong, and it produces a
 * one-cent mismatch on roughly one mixed-rate invoice in three when it is:
 *
 *   1. sum the gross per rate — exact, because each line total is already
 *      a 2-decimal figure;
 *   2. vat = round(gross x rate / (100 + rate));
 *   3. base = gross - vat, DERIVED BY SUBTRACTION, never rounded on its own.
 *
 * Step 3 is the trick. Rounding the base independently lets base + vat drift
 * from gross by a cent, and then the invoice needs a plug line to balance.
 * Subtracting guarantees base + vat === gross exactly, per group, so the
 * totals reconcile against the order with no residue.
 */
export function computeTaxBreakdown(lines: TaxLineInput[]): TaxBreakdown {
  const byRate = new Map<number, number>();
  for (const line of lines) {
    byRate.set(line.rate_pct, (byRate.get(line.rate_pct) ?? 0) + line.grossCents);
  }

  const groups: TaxGroup[] = [...byRate.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([rate_pct, gross_cents]) => {
      const vat_cents = roundHalfUp((gross_cents * rate_pct) / (100 + rate_pct));
      return { rate_pct, gross_cents, vat_cents, base_cents: gross_cents - vat_cents };
    });

  return {
    groups,
    taxable_base_cents: groups.reduce((s, g) => s + g.base_cents, 0),
    vat_total_cents: groups.reduce((s, g) => s + g.vat_cents, 0),
    gross_total_cents: groups.reduce((s, g) => s + g.gross_cents, 0),
  };
}

/** Euro string ("12.34") to cents, without going through a float multiply. */
export function eurosToCents(value: string | number): number {
  const s = typeof value === 'number' ? value.toFixed(2) : value.trim().replace(',', '.');
  const neg = s.startsWith('-');
  const [whole, frac = ''] = s.replace('-', '').split('.');
  const cents = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  return neg ? -cents : cents;
}

export function centsToEuros(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  return `${neg ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** The rate for a category, falling back to the 0 % default. */
export function rateForCategory(category: VatCategory | null | undefined): number {
  return VAT_RATES[category ?? 'zero'];
}
