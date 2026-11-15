-- CreateEnum
CREATE TYPE "ProductSource" AS ENUM ('admin', 'import', 'partner', 'quick_create');

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "created_by_admin_id" UUID,
ADD COLUMN     "created_source" "ProductSource" NOT NULL DEFAULT 'admin',
ADD COLUMN     "review_needed" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "products_review_needed_idx" ON "products"("review_needed");
