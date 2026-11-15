-- Partner import duplicates: rows a partner's Excel import flagged as
-- duplicating an existing product, held for review instead of being dropped.
--
-- A separate table from product_import_duplicates rather than a shared one.
-- That model's job_id FKs to product_import_jobs (the ADMIN importer); partner
-- imports live in partner_product_import_jobs. One column pointing at either
-- table would need a nullable pair plus a check constraint, and every query
-- would have to remember which side it is on. Two tables make the store-scoping
-- guarantee structural: a partner query cannot reach admin rows because they
-- are not in the same table.
--
-- store_id is denormalised from the job so every read can be scoped without a
-- join. Both FKs cascade — deleting a job or a store clears its pending rows.
--
-- Reuses the existing ImportDuplicateStatus enum; no new type.
--
-- ADDITIVE. New table only, no existing data touched, nothing dropped.

-- CreateTable
CREATE TABLE "partner_product_import_duplicates" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "source_row_number" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "matched_product_id" UUID,
    "matched_product_name" TEXT NOT NULL,
    "status" "ImportDuplicateStatus" NOT NULL DEFAULT 'pending',
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partner_product_import_duplicates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "partner_product_import_duplicates_store_id_status_created_a_idx" ON "partner_product_import_duplicates"("store_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "partner_product_import_duplicates_job_id_idx" ON "partner_product_import_duplicates"("job_id");

-- CreateIndex
CREATE INDEX "partner_product_import_duplicates_matched_product_id_idx" ON "partner_product_import_duplicates"("matched_product_id");

-- AddForeignKey
ALTER TABLE "partner_product_import_duplicates" ADD CONSTRAINT "partner_product_import_duplicates_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "partner_product_import_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_product_import_duplicates" ADD CONSTRAINT "partner_product_import_duplicates_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_product_import_duplicates" ADD CONSTRAINT "partner_product_import_duplicates_matched_product_id_fkey" FOREIGN KEY ("matched_product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

