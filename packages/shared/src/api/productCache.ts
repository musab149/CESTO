import type { Product } from '../types';

/**
 * Products the basket has already fetched, so adding one more product
 * fetches ONE product.
 *
 * useProductsByIds keys its query on the whole id list. That is right for
 * React Query — a different basket is a different answer — but every new key
 * started from nothing, and the cart drawer and floating cart bar are mounted
 * on every page of the website. So each "+" re-downloaded every product in
 * the basket: with 600–1,000 lines that was 6–10 requests of 100 products per
 * press. Adding quickly piled them up until the shop page and "who am I"
 * behind them timed out — "Store not found" and a signed-out header for a
 * signed-in shopper (staging, 2026-10-18).
 *
 * Kept per pricing mode: a business customer's wholesale prices must never
 * answer for retail, or the other way round, after a switch or a sign-in.
 *
 * Kept briefly. Price and stock do change, and the basket screens show both;
 * a minute is far shorter than anyone looks at a basket, and the server
 * prices the order again at checkout either way.
 */
export const PRODUCT_CACHE_TTL_MS = 60_000;

const cache = new Map<string, { at: number; product: Product }>();
const keyOf = (mode: string | null, id: string) => `${mode ?? 'retail'}:${id}`;

/**
 * The products for `ids`, in that order, fetching only the ones not seen in
 * the last minute. A product the server no longer returns (deactivated,
 * deleted) is left out, as the endpoint itself leaves it out.
 */
export async function productsByIdsCached(
  ids: string[],
  fetchMissing: (missing: string[]) => Promise<Product[]>,
  mode: string | null,
  now: () => number = Date.now,
): Promise<Product[]> {
  const startedAt = now();
  const fresh = (id: string) => {
    const hit = cache.get(keyOf(mode, id));
    return hit && startedAt - hit.at < PRODUCT_CACHE_TTL_MS ? hit.product : undefined;
  };
  const missing = [...new Set(ids.filter((id) => !fresh(id)))];
  const fetched = new Map<string, Product>();
  if (missing.length > 0) {
    const got = await fetchMissing(missing);
    const at = now();
    for (const p of got) {
      cache.set(keyOf(mode, p.id), { at, product: p });
      fetched.set(p.id, p);
    }
  }
  const out: Product[] = [];
  for (const id of ids) {
    const p = fetched.get(id) ?? fresh(id);
    if (p) out.push(p);
  }
  return out;
}

/** Forget everything — for tests, and for anything that must not be served stale. */
export function clearProductCache(): void {
  cache.clear();
}
