// ─── Go-live gate ──────────────────────────────────────────
//
// A partner may not publish their own store. `draft → live` is Cesto's
// approval and only the admin routes can perform it.
//
// This replaced an earlier rule that gated publication on owning at least
// one delivery zone. That rule was really about delivery economics — a zone
// carried the fee and the free-delivery minimum, so a live store without one
// had no price for reaching anybody. Zones are gone and the fee is now a
// single platform-wide setting, so the economic reason evaporated. The
// editorial reason did not: a storefront going live is Cesto putting its
// name to a partner, and that stays a decision a human makes.
//
// What a partner CAN still do is pause and un-pause. Un-pausing sets
// `live`, which looks like publishing but is not: the store was already
// approved, and pausing is a temporary self-serve hide. So the rule is about
// the state being left, not the state being entered —
//
//     draft     → live   ✗ admin only   (this is the approval)
//     suspended → live   ✗ admin only   (admin took it down; admin restores)
//     paused    → live   ✓ partner      (un-pausing an approved store)
//     live      → paused ✓ partner      (self-serve hide)
//
// Enforced in the API, not only in the UI: the partner endpoints are
// reachable directly with a customer JWT.
//
// Not expressible as a database constraint — Postgres cannot see who is
// making the request.

import prisma from './prisma';

export class StoreNotPublishableError extends Error {
  constructor(
    public readonly storeId: string,
    /** Status the store is actually in, for a message that names it. */
    public readonly currentStatus: string,
  ) {
    super('This store has not been approved for publication yet.');
    this.name = 'StoreNotPublishableError';
  }
}

type Db = { store: { findUnique: (args: unknown) => Promise<{ status: string } | null> } };

/**
 * Throws StoreNotPublishableError unless a PARTNER is allowed to move this
 * store to `live` — i.e. unless it is currently `paused`.
 *
 * Admin routes must not call this. Admin is the approval, so gating it on
 * prior approval would mean no store could ever be published at all.
 *
 * Pass the transaction client when called inside one, so the check sees a
 * status written earlier in the same transaction.
 */
export async function assertPartnerMayPublish(
  storeId: string,
  db: Db = prisma as unknown as Db,
): Promise<void> {
  const store = await db.store.findUnique({
    where: { id: storeId },
    select: { status: true },
  });
  // A missing store is not a publication problem — let the caller's own
  // 404 handling deal with it rather than reporting it as "not approved".
  if (!store) return;
  if (store.status !== 'paused') {
    throw new StoreNotPublishableError(storeId, store.status);
  }
}

/**
 * True when this update would put the store into `live`.
 *
 * Only a transition INTO live is gated. Editing unrelated fields on an
 * already-live store must keep working, or a partner locks themselves out of
 * their own storefront by touching their tagline.
 */
export function isGoingLive(nextStatus: string | undefined): boolean {
  return nextStatus === 'live';
}
