-- ─── Orders: soft-delete tombstone ─────────────────────────
-- Admins place test orders to exercise the checkout/fulfilment pipeline
-- end-to-end, and today there's no way to keep them out of the order list
-- or the dashboard's revenue/order-count aggregates — both read live Order
-- rows directly, so a test order quietly inflates real sales figures.
--
-- Deliberately NOT a hard delete (see [[delete-order]] plan): the row and
-- its items stay in the database — `deleted_at` just hides it from every
-- list/aggregate query. `status` is left untouched by the delete so the
-- order's real history stays intact for anyone who looks it up directly.
-- Mirrors the Store soft-delete shape from
-- 20260716120000_store_soft_delete (deleted_at + an admin-attributed
-- reason column, FK set-null on admin offboarding).
--
-- All additive, all nullable. No backfill needed — existing rows keep
-- `deleted_at = NULL`, which is the "live" (visible) state under the new
-- schema.

ALTER TABLE "orders"
  ADD COLUMN "deleted_at"          TIMESTAMP(3) NULL,
  ADD COLUMN "deleted_by_admin_id" UUID         NULL,
  ADD COLUMN "delete_reason"       TEXT         NULL;

-- FK to admins for audit. ON DELETE SET NULL so offboarding an admin
-- doesn't block/cascade-remove the order — the reason + timestamp stay
-- even after the actor who deleted it is gone.
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_deleted_by_admin_id_fkey"
  FOREIGN KEY ("deleted_by_admin_id")
  REFERENCES "admins"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Every list/aggregate read filters by deleted_at IS NULL.
CREATE INDEX "orders_deleted_at_idx" ON "orders" ("deleted_at");
