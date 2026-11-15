-- Admin-curated "New products" rail.
--
-- The home rail used to read created_at desc, so anything just inserted took
-- it over — a bulk Excel import or a routine catalogue edit rewrote the shop
-- front by accident. Listing there is now opt-in.
--
-- ADDITIVE. New column with a default, no backfill, nothing dropped. Existing
-- rows land on false, which means the rail is EMPTY until an admin marks
-- products — see the deploy note in the commit message.

ALTER TABLE "products" ADD COLUMN "is_new_arrival" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "products_is_new_arrival_idx" ON "products"("is_new_arrival");
