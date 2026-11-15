import prisma from './prisma';

/**
 * Store name to URL slug.
 *
 * Extracted from routes/admin/leads.ts, which had the only copy that also
 * checked uniqueness. `Store.slug` is UNIQUE, so a duplicate is an insert
 * failure rather than a cosmetic problem — which is exactly why the pair
 * belongs together in one place rather than being retyped per caller.
 *
 * (routes/admin/brands.ts and routes/admin/origins.ts each have their own
 * `slugify` for their own tables. Left alone: their uniqueness rules differ,
 * and folding three slightly different functions into one is a separate
 * change with its own risk.)
 */
export function slugifyStoreName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'store';
}

/**
 * First free slug of the form `base`, `base-2`, `base-3`, …
 *
 * Caps at 100 attempts then falls back to a timestamp suffix, so a pathological
 * name can never spin. Racy by nature — two simultaneous creates can agree on
 * the same candidate — but the UNIQUE index is the real guard and the caller
 * surfaces P2002.
 */
export async function makeUniqueStoreSlug(base: string): Promise<string> {
  let candidate = base;
  let n = 1;
  while (n < 100) {
    const existing = await prisma.store.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!existing) return candidate;
    n += 1;
    candidate = `${base}-${n}`;
  }
  return `${base}-${Date.now()}`;
}
