-- ─── OrderStatus: add 'draft' (reapply) ────────────────────
-- Draft orders for out-of-stock line items. Checkout (behind
-- MV_DRAFT_ORDERS) splits a store's cart into a normal sub-order for
-- in-stock items and a `draft` sub-order for out-of-stock ones instead of
-- hard-blocking the whole checkout. A draft sub-order's items are never
-- stock-decremented at creation — see lib/draftOrders.ts for how it's
-- resolved (confirm re-validates + decrements, or cancel with no restock).
--
-- This re-adds what migration 20260807120000_order_status_draft originally
-- added. That migration's effect was later undone by
-- 20260813000000_revert_order_status_draft (applied to this database but
-- never committed to the repo, so it isn't present under migrations/ here).
-- Postgres has no `ALTER TYPE ... DROP VALUE`, so that revert recreated
-- both enums from scratch without these values — meaning the original
-- migration's ledger row is marked "finished" even though the database no
-- longer has 'draft' / 'admin_draft_order'. Re-running the identically
-- named migration would be silently skipped (Prisma matches by name), so
-- this is a fresh migration with a new timestamp instead.
--
-- Additive-only per ground rule #1: existing rows keep their current
-- value, nothing reads 'draft' unless the flag is on, no default change.
--
-- Postgres allows ADD VALUE without wrapping in a transaction on 12+.

ALTER TYPE "OrderStatus" ADD VALUE 'draft';

-- ─── NotificationType: add 'admin_draft_order' (reapply) ───
-- Fired once per draft sub-order created at checkout, alongside the
-- existing admin_new_order ping, so the admin activity feed distinguishes
-- "needs stock resolved" from a normal new order.

ALTER TYPE "NotificationType" ADD VALUE 'admin_draft_order';
