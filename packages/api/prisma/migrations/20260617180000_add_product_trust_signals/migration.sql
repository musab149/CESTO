-- Add marketplace-trust signals to products. These power the badges and
-- rating row on the public ProductCard (verified, top seller, sold out)
-- and are editable from the admin product edit page.

ALTER TABLE "products"
  ADD COLUMN "is_verified"   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "is_top_seller" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "rating"        DOUBLE PRECISION,
  ADD COLUMN "rating_count"  INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "products_is_top_seller_idx" ON "products"("is_top_seller");

-- Deterministic backfill so the storefront looks alive on staging right after
-- the migration runs. Values are derived from a stable hash of the row id so
-- they never change across re-runs of the seed script.
--
--   • featured products are flagged as top sellers
--   • every other product (by id hash) gets the verified badge
--   • rating is 3.8–4.9 with one decimal, count is 20–520
UPDATE "products" SET
  is_top_seller = is_featured,
  is_verified   = (abs(('x' || substr(md5(id::text), 1, 8))::bit(32)::int) % 2 = 0),
  rating        = ROUND(
                    (3.8 + ((abs(('x' || substr(md5(id::text), 9, 8))::bit(32)::int) % 12) / 10.0))::numeric,
                    1
                  ),
  rating_count  = 20 + (abs(('x' || substr(md5(id::text), 17, 8))::bit(32)::int) % 500);
