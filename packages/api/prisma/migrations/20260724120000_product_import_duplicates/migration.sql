-- ─── Product import duplicates (staged for review) ─────
-- Rows the Excel importer flagged as duplicates of an existing product.
-- Instead of silently dropping them (previous behaviour), the worker now
-- inserts a row here in state 'pending' with the full parsed payload so
-- the admin can review on the Duplicates page → "From Excel import" tab
-- and either create-anyway (override the guard) or dismiss.
--
-- Additive migration. No existing rows or columns touched.

CREATE TYPE "ImportDuplicateStatus" AS ENUM (
    'pending',
    'created',
    'dismissed'
);

CREATE TABLE "product_import_duplicates" (
    "id"                     UUID                    NOT NULL,
    "job_id"                 UUID                    NOT NULL,
    "source_row_number"      INTEGER                 NOT NULL,
    "payload"                JSONB                   NOT NULL,
    "matched_product_id"     UUID,
    "matched_product_name"   TEXT                    NOT NULL,
    "status"                 "ImportDuplicateStatus" NOT NULL DEFAULT 'pending',
    "resolved_at"            TIMESTAMP(3),
    "created_at"             TIMESTAMP(3)            NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"             TIMESTAMP(3)            NOT NULL,

    CONSTRAINT "product_import_duplicates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "product_import_duplicates_status_created_at_idx"
    ON "product_import_duplicates" ("status", "created_at");

CREATE INDEX "product_import_duplicates_job_id_idx"
    ON "product_import_duplicates" ("job_id");

CREATE INDEX "product_import_duplicates_matched_product_id_idx"
    ON "product_import_duplicates" ("matched_product_id");

ALTER TABLE "product_import_duplicates"
    ADD CONSTRAINT "product_import_duplicates_job_id_fkey"
    FOREIGN KEY ("job_id") REFERENCES "product_import_jobs" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "product_import_duplicates"
    ADD CONSTRAINT "product_import_duplicates_matched_product_id_fkey"
    FOREIGN KEY ("matched_product_id") REFERENCES "products" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
