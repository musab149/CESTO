/**
 * Short-lived in-process cache for catalogue COUNT(*) queries.
 *
 * Why this exists — measured on production, 2026-08-04:
 *
 *   /api/health          (0 queries)  ~0.40s
 *   /api/banners         (1 query)    ~0.71s   → one DB round trip ≈ 300ms
 *   /api/products        (6 queries)  ~1.88s
 *
 * The SQL itself is fast: the same statements run in 3-12ms against a local
 * Postgres with a comparable catalogue. The cost is almost entirely the round
 * trip between the API (Render, virginia) and the database (Neon), paid once
 * per statement.
 *
 * A listing therefore pays that latency twice — once for the page of rows and
 * once for the total. But the total is O(whole catalogue) and, for the home
 * page rails, completely unused: they ask for 12 products and never render a
 * count or a pager. It was the reason `?limit=1` cost the same as `?limit=24`.
 *
 * Rather than change the response shape (every caller reads `total` and
 * `totalPages`), the count is memoised. Identical filters recur constantly —
 * every anonymous visitor hitting the home page issues the exact same three
 * catalogue queries — so a short TTL collapses thousands of identical COUNTs
 * into one per window.
 *
 * Deliberately in-process and unbounded-TTL-free rather than Redis: the values
 * are tiny, the API runs as a single instance, and a cache that can be stale by
 * at most TTL_MS is the entire risk. A product added right now can be missing
 * from a *total* for up to a minute; it is never missing from the *items*,
 * which are always read live.
 */

interface Entry {
  value: number;
  expires: number;
}

const cache = new Map<string, Entry>();

/** One minute. Long enough to absorb a traffic burst, short enough that an
 *  admin adding a product sees the count move while they are still looking. */
const TTL_MS = 60_000;

/** Guards against unbounded growth from high-cardinality filters (search
 *  strings, arbitrary category combinations). Well above the handful of
 *  distinct catalogue queries the storefront actually issues. */
const MAX_ENTRIES = 500;

/**
 * Returns a cached count, or runs `compute` and caches it.
 *
 * `key` must capture every input that changes the result — the serialised
 * where-clause, plus anything else that scopes it (browse country, postcode).
 * Getting this wrong shows up as a wrong total, not as wrong products.
 */
export async function cachedCount(key: string, compute: () => Promise<number>): Promise<number> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expires > now) return hit.value;

  const value = await compute();

  // Evict expired entries first; only fall back to dropping the oldest live
  // one if the map is still at capacity.
  if (cache.size >= MAX_ENTRIES) {
    for (const [k, v] of cache) if (v.expires <= now) cache.delete(k);
    if (cache.size >= MAX_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
  }

  cache.set(key, { value, expires: now + TTL_MS });
  return value;
}

/** Drop everything. Called after writes that change catalogue size so an
 *  admin creating or deleting a product sees totals move immediately. */
export function invalidateCountCache(): void {
  cache.clear();
}

/** Test/diagnostic helper. */
export function countCacheSize(): number {
  return cache.size;
}
