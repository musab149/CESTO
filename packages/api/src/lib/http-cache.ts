import type { Response } from 'express';
import type { Prisma } from '@prisma/client';

/**
 * Caching helpers for public catalogue reads.
 *
 * `private`, never `public`. These responses are viewer-dependent in a way
 * that is easy to miss: `b2bPricingGuard` rewrites `variant.price` to the
 * wholesale figure for an approved business account. A shared cache holding
 * one copy could hand a partner's wholesale margin to an anonymous shopper.
 * `private` confines it to the browser that asked.
 *
 * The result SET no longer varies by viewer — the browse-scope headers that
 * narrowed it (`X-Browse-Postcode`, `X-Browse-Country`) are gone — but the
 * PRICES inside it still do, which is why this stays private.
 *
 * The win is navigation, not first paint: moving between the home page,
 * a category and back currently re-fetches the same rails every time, and
 * each of those requests costs ~1.5s against the current Render/Neon setup.
 */

/** Seconds a browser may reuse a catalogue response without revalidating. */
const CATALOGUE_MAX_AGE = 30;
/** How long it may keep serving the stale copy while it refreshes behind. */
const CATALOGUE_SWR = 120;

export function setCatalogueCache(res: Response): void {
  res.setHeader(
    'Cache-Control',
    `private, max-age=${CATALOGUE_MAX_AGE}, stale-while-revalidate=${CATALOGUE_SWR}`,
  );
  // Authorization decides retail vs wholesale, so a cached copy must not
  // survive a login or logout. X-Pricing-Mode is listed for a subtler reason:
  // when a business customer toggles to wholesale, Authorization does NOT
  // change, so without varying on it the browser's own HTTP cache would keep
  // serving the pre-switch prices.
  //
  // X-Browse-Postcode / X-Browse-Country used to be here too. Both headers
  // are gone with the zone system — nothing scopes the catalogue by location,
  // so there is no location dimension left for a response to vary on.
  res.setHeader('Vary', 'Authorization, X-Pricing-Mode');
}

/**
 * Stable string for a Prisma where-clause, for use as a cache key.
 *
 * JSON.stringify alone is not enough: object key order follows insertion, and
 * these where-clauses are assembled conditionally, so two identical filters
 * built by different code paths would serialise differently and miss the
 * cache. Sorting keys at every level makes the key depend on meaning rather
 * than on construction order.
 */
export function stableKey(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) out[k] = sortDeep(src[k]);
    return out;
  }
  return value;
}

/** Convenience overload for the common case. */
export function whereKey(where: Prisma.ProductWhereInput): string {
  return stableKey(where);
}
