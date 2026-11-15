-- CreateEnum
CREATE TYPE "ReviewReportReason" AS ENUM ('spam', 'offensive', 'off_topic', 'personal_info', 'not_a_real_purchase');

-- CreateTable
CREATE TABLE "product_review_reports" (
    "id" UUID NOT NULL,
    "review_id" UUID NOT NULL,
    "reporter_id" UUID NOT NULL,
    "reason" "ReviewReportReason" NOT NULL,
    "note" VARCHAR(500),
    "dismissed_at" TIMESTAMP(3),
    "dismissed_by_admin_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_review_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_review_reports_dismissed_at_created_at_idx" ON "product_review_reports"("dismissed_at", "created_at");

-- CreateIndex
CREATE INDEX "product_review_reports_review_id_idx" ON "product_review_reports"("review_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_review_reports_review_id_reporter_id_key" ON "product_review_reports"("review_id", "reporter_id");

-- AddForeignKey
ALTER TABLE "product_review_reports" ADD CONSTRAINT "product_review_reports_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "product_reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_review_reports" ADD CONSTRAINT "product_review_reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
