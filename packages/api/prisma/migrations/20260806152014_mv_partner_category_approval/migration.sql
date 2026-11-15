-- CreateEnum
CREATE TYPE "CategoryApprovalStatus" AS ENUM ('pending', 'approved', 'rejected');

-- AlterTable
ALTER TABLE "categories" ADD COLUMN     "approval_status" "CategoryApprovalStatus" NOT NULL DEFAULT 'approved',
ADD COLUMN     "rejection_reason" TEXT,
ADD COLUMN     "reviewed_at" TIMESTAMP(3),
ADD COLUMN     "reviewed_by_admin_id" UUID,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'admin',
ADD COLUMN     "submitted_by_store_id" UUID,
ADD COLUMN     "submitted_by_user_id" UUID;

-- CreateIndex
CREATE INDEX "categories_approval_status_idx" ON "categories"("approval_status");

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_submitted_by_store_id_fkey" FOREIGN KEY ("submitted_by_store_id") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_reviewed_by_admin_id_fkey" FOREIGN KEY ("reviewed_by_admin_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;
