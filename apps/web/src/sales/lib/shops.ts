import type { SalesRepStore } from '@grocery-app/shared';

/*
 * The shops a rep sells from, as the screens need them (API lib/repStore —
 * one since 2026-10-25, several since 2026-10-26). Read the payload through
 * the shared `repStoresOf`, which also understands an API from before.
 */

/** The ones they can sell from now, and the ones switched off, suspended or being deleted. */
export function splitShops(shops: SalesRepStore[] | undefined) {
  const all = shops ?? [];
  return { sellable: all.filter((s) => s.sellable), unavailable: all.filter((s) => !s.sellable) };
}

/** Names as one phrase: "Wahed Mart, JK Cash & Carry y Cesto Shop". */
export function listNames(names: string[], lang: string): string {
  return new Intl.ListFormat(lang === 'en' ? 'en-GB' : 'es-ES', { style: 'long', type: 'conjunction' }).format(names);
}

/**
 * The shop filters' value for "the products assigned to me by hand" — not a
 * shop id, so the screens send `assigned=true` for it instead of a storeId.
 */
export const ASSIGNED = '__assigned';

/**
 * Products an admin assigned them by hand, from any shop, that they can sell
 * now (2026-10-27) — 0 when none or an API from before.
 */
export function assignedOf(me: { assigned_products?: number } | null | undefined): number {
  return me?.assigned_products ?? 0;
}

/**
 * What they sell from, as one line: "Vendes de A y B", "… y 12 productos
 * asignados", "Vendes 3 productos asignados" — null with nothing at all.
 */
export function sellingLine(
  t: (key: string, vars?: Record<string, string | number>) => string,
  lang: string,
  sellable: SalesRepStore[],
  assigned: number,
): string | null {
  const plural = (key: string) => `${key}_${assigned === 1 ? 'one' : 'other'}`;
  const names = sellable.length ? listNames(sellable.map((s) => s.name), lang) : '';
  if (names && assigned > 0) return t(plural('sales.today.shopFromPlus'), { name: names, count: assigned });
  if (names) return t('sales.today.shopFrom', { name: names });
  if (assigned > 0) return t(plural('sales.today.assignedOnly'), { count: assigned });
  return null;
}
