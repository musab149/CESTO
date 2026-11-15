/**
 * Brand discovery: search, letter bucketing, sorting and recents.
 *
 * Ported from apps/web/src/pages/BrandsPage.tsx so the two apps filter the
 * catalogue by the same rules. Kept as pure functions in src/lib for the same
 * reason as the rest of this folder: it is the part that can silently break,
 * and it is the part a unit test can reach without a device.
 *
 * Deliberately dependency-free — no shared barrel, no react-native. The test
 * runner loads this straight through ts-node.
 */

import { foldText } from './textFold';

export type BrandSort = 'featured' | 'name_asc' | 'name_desc' | 'count_desc';

/** The shape this module needs; screens pass richer objects through unchanged. */
export interface FilterableBrand {
  name: string;
}

export const ALPHABET: string[] = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '#'];

export const RECENT_BRANDS_KEY = 'cesto:recent-brands';
export const RECENT_BRANDS_MAX = 8;

// foldText moved to ./textFold once the origins screen needed it too. Still
// re-exported here so the brand call sites and their tests keep one import.
export { foldText } from './textFold';

/** Bucket a brand under its initial. Anything not A–Z lands under '#'. */
export function initialOf(name: string): string {
  const c = foldText(name).charAt(0).toUpperCase();
  return c >= 'A' && c <= 'Z' ? c : '#';
}

/** Two-letter monogram for brands with no logo — reads better than one at chip size. */
export function monogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export interface BrandFilterOptions<T extends FilterableBrand> {
  q?: string;
  letter?: string;
  sort?: BrandSort;
  hideEmpty?: boolean;
  /** Product count for a brand. Required only when sorting or hiding by stock. */
  countOf?: (brand: T) => number;
}

export function filterAndSortBrands<T extends FilterableBrand>(
  brands: T[],
  { q = '', letter = '', sort = 'featured', hideEmpty = false, countOf }: BrandFilterOptions<T> = {},
): T[] {
  const folded = foldText(q);
  const count = countOf ?? (() => 0);

  let list = brands.filter((b) => {
    if (folded && !foldText(b.name).includes(folded)) return false;
    if (letter && initialOf(b.name) !== letter) return false;
    if (hideEmpty && count(b) === 0) return false;
    return true;
  });

  // 'featured' keeps the admin's curated sort_order, which is the order the
  // API already returns — so it is the default and does nothing here.
  if (sort === 'name_asc')   list = [...list].sort((a, b) => a.name.localeCompare(b.name, 'es'));
  if (sort === 'name_desc')  list = [...list].sort((a, b) => b.name.localeCompare(a.name, 'es'));
  if (sort === 'count_desc') list = [...list].sort((a, b) => count(b) - count(a));
  return list;
}

/** Whether any filter is doing work — drives the "clear all" affordance. */
export function isBrandFilterActive(o: {
  q?: string; letter?: string; sort?: BrandSort; hideEmpty?: boolean;
}): boolean {
  return !!o.q || !!o.letter || !!o.hideEmpty || (!!o.sort && o.sort !== 'featured');
}

/**
 * Letter headings over an already-sorted list. Only meaningful for 'name_asc';
 * headings over a count-ordered list would be a lie about the order, so the
 * caller decides when to group.
 */
export function groupByInitial<T extends FilterableBrand>(
  list: T[],
): { letter: string; brands: T[] }[] {
  const map = new Map<string, T[]>();
  for (const b of list) {
    const L = initialOf(b.name);
    const bucket = map.get(L);
    if (bucket) bucket.push(b);
    else map.set(L, [b]);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([letter, brands]) => ({ letter, brands }));
}

/** Newest first, de-duplicated, capped. Pure half of the AsyncStorage recents. */
export function nextRecentBrands(
  current: string[],
  name: string,
  max: number = RECENT_BRANDS_MAX,
): string[] {
  return [name, ...current.filter((n) => n !== name)].slice(0, max);
}

/** Tolerant parse of whatever was in storage — a bad blob must not break the screen. */
export function parseRecentBrands(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === 'string').slice(0, RECENT_BRANDS_MAX)
      : [];
  } catch {
    return [];
  }
}
