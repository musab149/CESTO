-- ─── Stores: track auto-created suggestions ───────────
-- Mirrors the source column we added to brands + origins on 2026-07-13.
-- Excel importer now auto-creates unknown stores as is_active=false,
-- source='import' rows so admins can review them under the "Suggestions
-- from imports" filter on the /stores page — same UX as brands/origins.
--
-- Additive migration, backfill safe: existing rows default to 'manual',
-- which is the correct interpretation for anything created before this
-- shipped.

ALTER TABLE "stores" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'manual';

CREATE INDEX "stores_source_is_active_idx" ON "stores" ("source", "is_active");
