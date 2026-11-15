-- ─── ProductVariant B2B price ──────────────────────────
-- Adds a nullable wholesale price alongside the retail price + strike-through
-- price on every product variant. Null = no B2B pricing on that variant.
-- Only surfaced to customers with a B2B role (future work — approved through
-- the b2b-deals flow); regular customers keep seeing `price` untouched.

ALTER TABLE "product_variants" ADD COLUMN "b2b_price" DECIMAL(10, 2);
