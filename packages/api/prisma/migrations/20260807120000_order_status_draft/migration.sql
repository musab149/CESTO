-- ─── Order status: add 'draft' (reverted) ───────────────────
-- Recreated 2026-08-13 to reconcile migration history with the database:
-- this migration was applied to the dev DB on 2026-08-07, then the feature
-- was reverted in application code (commit d1d0aa1) without a matching
-- down-migration, leaving the DB with two enum values no code writes
-- anymore and a local migrations folder that had been deleted along with
-- the reverted code. This file restores the folder so `prisma migrate dev`
-- stops reporting drift; the very next migration
-- (20260813000000_revert_order_status_draft) removes both values again,
-- so the net effect on schema is a no-op — only migration history changes.

ALTER TYPE "OrderStatus" ADD VALUE 'draft';
ALTER TYPE "NotificationType" ADD VALUE 'admin_draft_order';
