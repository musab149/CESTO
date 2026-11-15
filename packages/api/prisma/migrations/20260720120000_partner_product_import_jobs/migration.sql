-- CreateTable
CREATE TABLE "partner_product_import_jobs" (
    "id" UUID NOT NULL,
    "partner_user_id" UUID,
    "store_id" UUID NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "status" "ImportJobStatus" NOT NULL DEFAULT 'queued',
    "total" INTEGER,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "result" JSONB,
    "error_message" TEXT,
    "filename" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "partner_product_import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "partner_product_import_jobs_store_id_created_at_idx" ON "partner_product_import_jobs"("store_id", "created_at");

-- CreateIndex
CREATE INDEX "partner_product_import_jobs_partner_user_id_created_at_idx" ON "partner_product_import_jobs"("partner_user_id", "created_at");

-- CreateIndex
CREATE INDEX "partner_product_import_jobs_idempotency_key_idx" ON "partner_product_import_jobs"("idempotency_key");

-- CreateIndex
CREATE INDEX "partner_product_import_jobs_status_idx" ON "partner_product_import_jobs"("status");

-- AddForeignKey
ALTER TABLE "partner_product_import_jobs" ADD CONSTRAINT "partner_product_import_jobs_partner_user_id_fkey" FOREIGN KEY ("partner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_product_import_jobs" ADD CONSTRAINT "partner_product_import_jobs_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
