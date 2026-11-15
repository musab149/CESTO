-- The one shop a sales rep sells from (2026-10-25): an admin assigns it, and
-- the rep's catalogue — so every order they build or add to — holds only that
-- shop's active products. Cesto's own catalogue (products with no shop) has no
-- Store row, so it is its own flag. Additive: every existing rep starts with
-- neither, and sells nothing until an admin assigns one.

-- AlterTable
ALTER TABLE "sales_reps" ADD COLUMN "store_id" UUID;
ALTER TABLE "sales_reps" ADD COLUMN "house_store" BOOLEAN NOT NULL DEFAULT false;

-- One shop, never both.
ALTER TABLE "sales_reps" ADD CONSTRAINT "sales_reps_one_shop" CHECK (NOT ("house_store" AND "store_id" IS NOT NULL));

-- CreateIndex
CREATE INDEX "sales_reps_store_id_idx" ON "sales_reps"("store_id");

-- AddForeignKey: a shop deleted for good leaves its reps with none.
ALTER TABLE "sales_reps" ADD CONSTRAINT "sales_reps_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;
