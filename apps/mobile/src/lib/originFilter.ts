/**
 * Origin discovery: search and sorting for the Shop-by-Origin screen.
 *
 * Ported from apps/web/src/pages/OriginsPage.tsx. Deliberately a smaller set
 * of controls than the brands screen has — web gives origins no A–Z rail and
 * no recently-viewed, because a couple of dozen countries do not need
 * alphabet navigation the way a few hundred brands do.
 *
 * Two things differ from [[brandFilter]] beyond that. Search matches BOTH
 * language labels, so "spain" finds España whichever language the app is in;
 * and A–Z sorts by the label actually on screen, so the order matches what
 * the shopper is reading.
 *
 * Dependency-free apart from the shared fold, so ts-node can load it.
 */
import { foldText } from './textFold';

export type OriginSort = 'featured' | 'name_asc' | 'count_desc';

/** The shape this module needs; screens pass richer cards through unchanged. */
export interface FilterableOrigin {
  key: string;
  label_es: string;
  label_en: string;
}

export interface OriginFilterOptions<T extends FilterableOrigin> {
  q?: string;
  sort?: OriginSort;
  hideEmpty?: boolean;
  /** Display language — decides which label A–Z orders by. */
  lang?: 'en' | 'es';
  /** Product count for an origin. Required only when sorting or hiding by stock. */
  countOf?: (origin: T) => number;
}

const labelFor = (o: FilterableOrigin, lang: 'en' | 'es') =>
  (lang === 'en' ? o.label_en : o.label_es);

export function filterAndSortOrigins<T extends FilterableOrigin>(
  cards: T[],
  { q = '', sort = 'featured', hideEmpty = false, lang = 'es', countOf }: OriginFilterOptions<T> = {},
): T[] {
  const folded = foldText(q);
  const count = countOf ?? (() => 0);

  let list = cards.filter((c) => {
    // Both labels, not just the displayed one: a shopper typing "spain" in the
    // Spanish UI still means España.
    if (folded
      && !foldText(c.label_es).includes(folded)
      && !foldText(c.label_en).includes(folded)) return false;
    if (hideEmpty && count(c) === 0) return false;
    return true;
  });

  // 'featured' is the admin's curated sort_order, which is the order the API
  // returns, so it does nothing here.
  if (sort === 'name_asc') {
    list = [...list].sort((a, b) =>
      labelFor(a, lang).localeCompare(labelFor(b, lang), 'es'));
  }
  if (sort === 'count_desc') list = [...list].sort((a, b) => count(b) - count(a));
  return list;
}

/** Whether any filter is doing work — drives the "clear all" affordance. */
export function isOriginFilterActive(o: {
  q?: string; sort?: OriginSort; hideEmpty?: boolean;
}): boolean {
  return !!o.q || !!o.hideEmpty || (!!o.sort && o.sort !== 'featured');
}
