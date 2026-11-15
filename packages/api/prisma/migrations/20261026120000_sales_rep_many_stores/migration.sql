-- A sales rep sells from several shops (2026-10-26, user request): "admin can
-- assign multiple stores to the rep and from those assigned stores the
-- products will show to them". Replaces the one-shop column of
-- 20261025200000_sales_rep_store.
--
-- Additive. The old column sales_reps.store_id is copied in and LEFT IN PLACE:
-- the server running the previous code reads it until the new one takes over.
-- Nothing reads or writes it after that; a later migration drops it.

-- CreateTable
CREATE TABLE "sales_rep_stores" (
    "sales_rep_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_rep_stores_pkey" PRIMARY KEY ("sales_rep_id","store_id")
);

-- CreateIndex
CREATE INDEX "sales_rep_stores_store_id_idx" ON "sales_rep_stores"("store_id");

-- AddForeignKey: a rep's rows go with the rep; a shop deleted for good takes
-- its rows with it, as the old column went to NULL.
ALTER TABLE "sales_rep_stores" ADD CONSTRAINT "sales_rep_stores_sales_rep_id_fkey" FOREIGN KEY ("sales_rep_id") REFERENCES "sales_reps"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sales_rep_stores" ADD CONSTRAINT "sales_rep_stores_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every shop already assigned carries over.
INSERT INTO "sales_rep_stores" ("sales_rep_id", "store_id")
SELECT "user_id", "store_id" FROM "sales_reps" WHERE "store_id" IS NOT NULL
ON CONFLICT DO NOTHING;

-- "One shop, never both" no longer holds: Cesto's own catalogue (house_store)
-- now sits beside any number of shops, and the old column keeps its last value
-- until it is dropped, so the check would refuse adding Cesto's own to a rep
-- who had a shop.
ALTER TABLE "sales_reps" DROP CONSTRAINT IF EXISTS "sales_reps_one_shop";
