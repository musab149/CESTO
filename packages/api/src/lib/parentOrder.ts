import type { OrderStatus } from '@prisma/client';

import { dayMonth, randomCode } from './pagination';

// ─── MV Slice 4 helpers ────────────────────────────────────
// Shared between checkout (creation) and the read endpoints (derived
// status on the wire). Kept dependency-free so the test file next door
// can exercise the pure logic without pulling in Prisma at test time.

/**
 * Human-readable parent-order number. Same shape as `generateOrderNumber`
 * with a `-P` suffix so a parent stands out from its subs in logs,
 * receipts, and admin search. Random component is uppercase base-36; the
 * suffix keeps it easy to grep for parents specifically.
 *
 * Example: "ORD-2107-9F3K-P"
 */
export function generateParentOrderNumber(): string {
  // Shares the generator with sub-orders so both get the same entropy. See
  // lib/pagination.ts for why 4 characters of Math.random() was not enough.
  return `ORD-${dayMonth()}-${randomCode()}-P`;
}

// ─── Derived parent status ─────────────────────────────────
// A ParentOrder has no status column of its own — the customer-visible
// state is a pure function of its sub-orders. Kept as a helper (rather
// than a Postgres view) so the tricky mixed-terminal case has a clear
// place to live and can be unit-tested without touching the DB.
//
// Rules (adapted from MULTIVENDOR_ROADMAP.md Slice 4 + use case §7):
//
//   0. Any sub is draft     → draft  (MV_DRAFT_ORDERS)
//   1. Every sub delivered  → delivered
//   2. Every sub cancelled  → cancelled
//   3. Every sub is terminal (delivered | cancelled) but mixed
//                           → partially_completed  (new enum value)
//   4. Otherwise            → the LEAST-progressed active sub's status.
//      Cancelled subs are excluded from the min — a killed sub shouldn't
//      downgrade a still-progressing parent (e.g. one cancelled + one
//      on_the_way stays on_the_way, not "pending because cancelled=0").
//
// Rule 0 takes priority over everything else: a draft sub means part of the
// purchase needs the customer's (or admin/vendor's) attention before it can
// move at all, which is more actionable than surfacing whatever state its
// siblings happen to be in. It's checked first rather than folded into rule
// 4's ranking because draft isn't really "less progressed" than pending —
// it's a different axis (blocked-on-stock vs blocked-on-nothing).
//
// Rule 4 deviates from the roadmap's shorthand ("any sub pending → parent
// preparing") in favour of surfacing the actual least-progressed state,
// which is more informative and never worse for the customer's mental
// model. Falls back to `pending` for an empty list (shouldn't happen —
// checkout always creates ≥1 sub — but keeps the type total).

type ActiveOrderStatus = 'pending' | 'confirmed' | 'preparing' | 'on_the_way';

const ACTIVE_RANK: Record<ActiveOrderStatus, number> = {
  pending:    0,
  confirmed:  1,
  preparing:  2,
  on_the_way: 3,
};

/** An order still on its way, in route order — what `GET /api/orders?active=1` lists. */
export const IN_PROGRESS_STATUSES = Object.keys(ACTIVE_RANK) as ActiveOrderStatus[];

function isTerminal(s: OrderStatus): boolean {
  return s === 'delivered' || s === 'cancelled';
}

export function deriveParentOrderStatus(subStatuses: OrderStatus[]): OrderStatus {
  if (subStatuses.length === 0) return 'pending';

  if (subStatuses.some((s) => s === 'draft'))      return 'draft';
  if (subStatuses.every((s) => s === 'delivered')) return 'delivered';
  if (subStatuses.every((s) => s === 'cancelled')) return 'cancelled';
  if (subStatuses.every(isTerminal))               return 'partially_completed';

  const active = subStatuses.filter((s): s is ActiveOrderStatus => !isTerminal(s));
  // Guarded above — if every sub was terminal we would have returned already.
  return active.reduce<ActiveOrderStatus>(
    (min, s) => (ACTIVE_RANK[s] < ACTIVE_RANK[min] ? s : min),
    active[0],
  );
}
