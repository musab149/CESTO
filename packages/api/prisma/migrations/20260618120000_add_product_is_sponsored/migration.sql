-- Add an admin-curated "sponsored" flag to products. Surfaces the product in
-- the home "Sponsored picks" rail and on /categories?sponsored=1. Distinct
-- from is_featured: featured is editorial, sponsored is paid placement.

ALTER TABLE "products"
  ADD COLUMN "is_sponsored" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "products_is_sponsored_idx" ON "products"("is_sponsored");

-- Deterministic backfill so the storefront has *something* in the Sponsored
-- rail right after the migration runs on staging. Picks roughly every 4th
-- featured product by a stable hash of the id; never changes across re-runs.
UPDATE "products" SET
  is_sponsored = is_featured
    AND (abs(('x' || substr(md5(id::text), 25, 8))::bit(32)::int) % 4 = 0);
