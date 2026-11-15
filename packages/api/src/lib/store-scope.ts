// ─── Store visibility helper ─────────────────────────────
// Every customer-facing query that touches Store rows (or Product rows
// via their store relation) MUST filter out stores that are on the
// soft-delete path — both scheduled-for-deletion (grace window) and
// permanently-deleted (tombstoned). Otherwise customers keep seeing the
// storefront and its products right up until the row's tombstoned.
//
// Design rationale: feedback_store-soft-delete-pattern in memory.

import type { Prisma } from '@prisma/client';

/** Where-clause fragment for customer Store queries. Excludes stores that
 *  aren't visible to customers: the admin-toggled `is_active` flag,
 *  soft-delete pipeline (scheduled OR tombstoned), PLUS MV Slice 1
 *  additions (draft/suspended `status`, and mv test rows). Includes
 *  `is_active` itself — do not spread an extra `is_active: true` alongside
 *  this at call sites, it's redundant. Compose via spread for any other
 *  domain filters.
 *
 *  `is_active` is included here specifically because this fragment also
 *  gets nested inside a `store: {...}` relation filter (see
 *  `customerStoreVisibleProductFilter` and `visibleRashanPackWhere` below) —
 *  a caller of THAT can't inject a sibling `store.is_active` after the
 *  fact, so it has to live in the shared fragment or it silently never gets
 *  checked. (It didn't, for a while — a deactivated store's products and
 *  rashan packs kept showing up everywhere except the store's own page,
 *  which reaches `is_active` through `isStoreCustomerVisible()` instead.)
 *
 *  Example:
 *    prisma.store.findMany({ where: { ...customerVisibleStoreFilter, ... } })
 *
 *  Typed as StoreWhereInput (not `as const`) so spreading into a mutable
 *  Prisma where-object doesn't trigger readonly-vs-mutable errors under
 *  strict tsc. `tsc --noEmit` in the API's build catches those; ts-node-dev
 *  locally is more lenient, which is how I let this through the first time.
 *
 *  MV Slice 1 additions (`status`, `is_test`) are cast through `unknown`
 *  so this compiles against a pre-Slice-0-regen Prisma client too. Runtime
 *  is safe — the columns exist in the DB after
 *  20260716180000_mv_slice-0_foundation.
 */
export const customerVisibleStoreFilter: Prisma.StoreWhereInput = {
  is_active: true,
  deletion_scheduled_at: null,
  deleted_at: null,
  ...({ status: 'live', is_test: false } as unknown as Prisma.StoreWhereInput),
};

/** Where-clause fragment for customer Product queries that respects the
 *  parent store's visibility, including the store's `is_active` flag (see
 *  `customerVisibleStoreFilter` above). Orphan products (store_id = null)
 *  stay visible — they predate the Store model and belong to the house shop.
 *
 *  Example:
 *    prisma.product.findMany({
 *      where: { is_active: true, ...customerStoreVisibleProductFilter, ... }
 *    })
 */
export const customerStoreVisibleProductFilter: Prisma.ProductWhereInput = {
  OR: [
    { store_id: null },
    { store: customerVisibleStoreFilter },
  ],
};

/** Where-clause fragment for customer RashanPack queries.
 *
 *  Two independent rules, AND-ed rather than spread into one object: each
 *  emits its own top-level `OR`, so spreading would have the last silently
 *  win and drop the other.
 *
 *    1. Cesto packs (store_id null) always; partner packs only while their
 *       store is customer-visible.
 *    2. Never a pack Cesto has taken down. Partner packs publish instantly
 *       with no review queue, so `admin_blocked_at` is the moderation lever
 *       and it has to outrank the partner's own `is_active` toggle.
 *
 *  This used to also carry a delivery-area filter. Coverage is no longer
 *  modelled — every live store sells everywhere — so a pack is visible on
 *  store status and moderation alone.
 */
export const customerVisibleRashanPackFilter: Prisma.RashanPackWhereInput = {
  AND: [
    { OR: [{ store_id: null }, { store: customerVisibleStoreFilter }] },
    { admin_blocked_at: null },
  ],
};

/** True if a store row is currently visible to customers.
 *  Use after a findUnique-by-slug to reject 404s cleanly.
 *
 *  MV Slice 1: also checks status='live' and is_test=false. Both fields
 *  are optional on the input so pre-Slice-0 rows (that lack them in the
 *  generated client type) still typecheck. */
export function isStoreCustomerVisible(store: {
  is_active: boolean;
  deletion_scheduled_at: Date | null;
  deleted_at: Date | null;
  status?: string;
  is_test?: boolean;
}): boolean {
  if (!store.is_active) return false;
  if (store.deletion_scheduled_at !== null) return false;
  if (store.deleted_at !== null) return false;
  if (store.status !== undefined && store.status !== 'live') return false;
  if (store.is_test === true) return false;
  return true;
}
