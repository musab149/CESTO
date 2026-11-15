-- Additive: adds a nullable-safe (default false) flag so the storefront can
-- show a "Request quotation" button on the product detail page. Safe to run
-- independent of any other pending migration.
ALTER TABLE "products" ADD COLUMN "is_quotation_enabled" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "products_is_quotation_enabled_idx" ON "products"("is_quotation_enabled");
