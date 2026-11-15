-- Who quick-created this product, when a sales rep did.
--
-- A rep is a User carrying a SalesRep row, not an Admin, so they cannot be
-- recorded in products.created_by_admin_id. Same two-column arrangement as
-- orders and users, added for the same reason and in the same shape.
--
-- Entirely additive: one nullable column, one FK, one index. No backfill —
-- every existing row predates reps and correctly reads NULL.

ALTER TABLE "products" ADD COLUMN "created_by_sales_rep_id" UUID;

-- SET NULL rather than CASCADE: deleting the account must not delete the
-- catalogue. The row survives the person, exactly as orders and clients do.
ALTER TABLE "products"
  ADD CONSTRAINT "products_created_by_sales_rep_id_fkey"
  FOREIGN KEY ("created_by_sales_rep_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "products_created_by_sales_rep_id_idx"
  ON "products"("created_by_sales_rep_id");
