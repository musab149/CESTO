import { Prisma, RashanFrequency } from '@prisma/client';
import prisma from './prisma';
import { VAT_FIELDS, vatRateOf, withVat } from './pricing';

export interface PackItem {
  product_id: string;
  variant_id: string;
  quantity: number;
}

/**
 * Days between cycles for each frequency — the LEGACY pack subscriptions'
 * reading, where monthly is 30 days. Home Grocery plans count in weeks
 * (monthly = 28 days, so a delivery keeps its weekday): see PLAN_WEEKS in
 * lib/homeGroceryPlan.ts.
 */
export const FREQUENCY_DAYS: Record<RashanFrequency, number> = {
  weekly: 7,
  biweekly: 14,
  every_3_weeks: 21,
  monthly: 30,
  every_6_weeks: 42,
};

/** Validate items shape — every entry needs the trio. */
export function isValidItems(value: unknown): value is PackItem[] {
  if (!Array.isArray(value)) return false;
  return value.every(
    (i) =>
      i &&
      typeof i === 'object' &&
      typeof (i as PackItem).product_id === 'string' &&
      typeof (i as PackItem).variant_id === 'string' &&
      typeof (i as PackItem).quantity === 'number' &&
      (i as PackItem).quantity > 0,
  );
}

/**
 * Compute the per-cycle subtotal of a list of items using current variant prices.
 * Returns 0 for invalid items / unknown variants. Used for display + storing
 * `total_per_cycle` snapshots. With each product's IVA, as a customer pays
 * them (lib/pricing).
 */
export async function computeItemsTotal(items: PackItem[]): Promise<{ total: Prisma.Decimal; itemCount: number }> {
  if (items.length === 0) return { total: new Prisma.Decimal(0), itemCount: 0 };
  const variants = await prisma.productVariant.findMany({
    where: { id: { in: items.map((i) => i.variant_id) } },
    select: { id: true, price: true, product: { select: VAT_FIELDS } },
  });
  let total = new Prisma.Decimal(0);
  let itemCount = 0;
  for (const it of items) {
    const v = variants.find((x) => x.id === it.variant_id);
    if (!v) continue;
    total = total.plus(withVat(v.price, vatRateOf(v.product)).mul(it.quantity));
    itemCount += it.quantity;
  }
  return { total, itemCount };
}

/** Add days to a date, returning a new Date. */
export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/** First delivery defaults to today + frequency days unless caller overrides. */
export function defaultFirstDelivery(frequency: RashanFrequency, fromDate: Date = new Date()): Date {
  return addDays(fromDate, FREQUENCY_DAYS[frequency]);
}
