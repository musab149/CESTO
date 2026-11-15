-- ─── Brands + Origins: track auto-created suggestions ─
-- Adds a `source` column so the admin UI can tell "I added this brand" from
-- "the Excel importer parked this here for me to review". Combined with
-- `is_active=false`, that gives us a clean "Suggestions" surface on the
-- BrandsPage / OriginsPage: rows with source='import' AND is_active=false
-- are pending admin review; activating (or editing) them clears the badge
-- naturally because the display condition includes `is_active=false`.
--
-- Additive migration, backfill safe: existing rows default to 'manual' —
-- correct interpretation since they were all added by hand before this
-- ships.

ALTER TABLE "brands"  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE "origins" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'manual';
