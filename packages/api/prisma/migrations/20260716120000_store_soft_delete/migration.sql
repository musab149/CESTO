-- ─── Stores: soft-delete with grace period ───────────────
-- Deleting a store used to be a single DELETE — one click, gone. That's
-- dangerous today and becomes catastrophic under mv where a Store owns a
-- partner's whole livelihood. This migration lands the columns for the
-- schedule → 5-day grace → permanent-delete flow, plus a tombstone so we
-- never truly hard-delete a Store row (order history stays queryable).
--
-- All additive, all nullable. No backfill needed — existing rows keep
-- `deletion_scheduled_at = NULL` and `deleted_at = NULL`, which is the
-- "live" state under the new schema.

ALTER TABLE "stores"
  ADD COLUMN "deletion_scheduled_at"          TIMESTAMP(3) NULL,
  ADD COLUMN "deletion_scheduled_by_admin_id" UUID         NULL,
  ADD COLUMN "deletion_reason"                TEXT         NULL,
  ADD COLUMN "deleted_at"                     TIMESTAMP(3) NULL;

-- FK to admins for audit. ON DELETE SET NULL so offboarding an admin
-- doesn't wipe the store — audit trail keeps the reason + timestamp
-- even after the actor is gone.
ALTER TABLE "stores"
  ADD CONSTRAINT "stores_deletion_scheduled_by_admin_id_fkey"
  FOREIGN KEY ("deletion_scheduled_by_admin_id")
  REFERENCES "admins"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Two focused indexes: the pending-deletion query filters by scheduled_at,
-- and every customer read filters by deleted_at IS NULL.
CREATE INDEX "stores_deletion_scheduled_at_idx" ON "stores" ("deletion_scheduled_at");
CREATE INDEX "stores_deleted_at_idx"            ON "stores" ("deleted_at");
