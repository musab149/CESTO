import { useMemo, useState } from 'react';
import {
  repStoresOf, useSalesMe, useSalesStores, useSalesCategories, useSalesOriginsTable, useSalesBrandsTable,
  useSalesProductsList, type ShopHours,
} from '@grocery-app/shared';
import { assignedOf, splitShops } from '../../lib/shops';
import { useSalesT } from '../../lib/i18n';

/** The Catálogo's four ways in, in the order the tabs show them. */
export type BrowseKind = 'stores' | 'categories' | 'origins' | 'brands';
export const BROWSE_KINDS: BrowseKind[] = ['stores', 'categories', 'origins', 'brands'];

/** "141 productos" — nothing while the API does not send a count. */
export function useCountLine() {
  const t = useSalesT();
  return (n: number | undefined) =>
    n === undefined ? null : t(n === 1 ? 'sales.catalogue.products_one' : 'sales.catalogue.products_other', { count: n });
}

/** A picture's address while it loads, null once it has failed — so a card falls back to its tint. */
export function useImage(url: string | null | undefined): [string | null, () => void] {
  const [failed, setFailed] = useState<string | null>(null);
  const ok = url && failed !== url ? url : null;
  return [ok, () => setFailed(url ?? null)];
}

/** A row's name in the panel's language, Spanish when it has no English one. */
export const nameOf = (x: { name_es: string; name_en?: string | null }, lang: 'es' | 'en') =>
  (lang === 'en' && x.name_en) || x.name_es;

/** The tints a card without its picture is washed in (components/catalogue/Browse). */
export const TINTS = [
  { well: 'bg-gradient-to-br from-st-sky-soft to-st-sky-soft-2', fg: 'text-st-sky-fg', stripe: 'fill-st-sky-dot' },
  { well: 'bg-gradient-to-br from-st-blue-soft to-st-blue-soft-2', fg: 'text-st-blue-fg', stripe: 'fill-st-blue-dot' },
  { well: 'bg-gradient-to-br from-st-violet-soft to-st-violet-soft-2', fg: 'text-st-violet-fg', stripe: 'fill-st-violet-dot' },
  { well: 'bg-gradient-to-br from-st-amber-soft to-st-amber-soft-2', fg: 'text-st-amber-fg', stripe: 'fill-st-amber-dot' },
  { well: 'bg-gradient-to-br from-st-emerald-soft to-st-emerald-soft-2', fg: 'text-st-emerald-fg', stripe: 'fill-st-emerald-dot' },
] as const;
export type Tint = (typeof TINTS)[number];
/** Cesto's own catalogue: always the brand's blue. */
export const HOUSE_TINT: Tint = TINTS[1];

/** The same tint for the same row, wherever it is listed. */
export function tintOf(id: string): Tint {
  let n = 0;
  for (let i = 0; i < id.length; i++) n = (n * 31 + id.charCodeAt(i)) >>> 0;
  return TINTS[n % TINTS.length];
}

/** The id Cesto's own catalogue goes by, in the rep's shops and in product filters. */
export const HOUSE = 'cesto';
/** The "shop" id of the products assigned to them by hand. */
export const ASSIGNED_ID = 'assigned';

export interface ShopCard {
  id: string;
  name: string;
  logo_url: string | null;
  logo_bg?: string | null;
  cover_url?: string | null;
  tagline_es?: string | null;
  tagline_en?: string | null;
  shop_hours?: ShopHours | null;
  products?: number;
}

/** Plain letters, for matching what a rep types against names. */
export const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();

/**
 * What the Catálogo's browse page and the lists behind its cards read: the
 * rep's shops — from /me, which knows which they may sell from, with each
 * shop's banner and hours from /catalogue/stores — and the categories,
 * origins and brands that have something of theirs, each with its count.
 * Every list is the taxonomy cache the order screen already holds.
 */
export function useBrowseData() {
  const { data: me } = useSalesMe();
  const shops = repStoresOf(me);
  const { sellable, unavailable } = splitShops(shops);
  const assigned = assignedOf(me);
  const house = sellable.some((s) => s.id === HOUSE);

  const storesQ = useSalesStores({ limit: 200 });
  const categoriesQ = useSalesCategories();
  const originsQ = useSalesOriginsTable();
  const brandsQ = useSalesBrandsTable();
  // Cesto's own has no shop row to count it: its list's total is the count.
  const houseQ = useSalesProductsList({ storeId: HOUSE, prices: 'both', limit: 1 }, house);

  const shopCards = useMemo<ShopCard[]>(() => {
    const details = new Map((storesQ.data?.items ?? []).map((s) => [s.id, s]));
    return sellable
      .filter((s) => s.id !== HOUSE)
      .map((s) => ({ id: s.id, name: s.name, logo_url: s.logo_url, ...details.get(s.id) }));
  }, [sellable, storesQ.data]);

  // Only those with something of theirs, so no card opens onto nothing; every
  // one on an API from before shops, which sends no count.
  const categories = useMemo(
    () => (categoriesQ.data ?? []).filter((c) => c.shop_products === undefined || c.shop_products > 0),
    [categoriesQ.data],
  );
  // The brands they carry most first: a rep reaches for those. Names break ties.
  const brands = useMemo(
    () => [...(brandsQ.data ?? [])].sort((a, b) => (b.products ?? 0) - (a.products ?? 0) || a.name.localeCompare(b.name)),
    [brandsQ.data],
  );

  return {
    me,
    shopsKnown: shops !== undefined,
    sellable,
    unavailable,
    assigned,
    house,
    houseCount: house ? houseQ.data?.total : undefined,
    shopCards,
    /** Something can be sold: a shop, or products assigned by hand. */
    shopOk: sellable.length > 0 || assigned > 0,
    /** More than one shop can be on a list's screen, so cards name theirs. */
    manyShops: sellable.length > 1 || assigned > 0,
    allCategories: categoriesQ.data ?? [],
    categories,
    origins: originsQ.data ?? [],
    brands,
    queries: { stores: storesQ, categories: categoriesQ, origins: originsQ, brands: brandsQ },
  };
}
