-- CreateEnum
CREATE TYPE "VatCategory" AS ENUM ('super_reduced', 'reduced', 'general');

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "tax_amount" DECIMAL(10,2),
ADD COLUMN     "tax_rate_pct" INTEGER,
ADD COLUMN     "vat_category" "VatCategory";

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "tax_breakdown" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "tax_total" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "parent_orders" ADD COLUMN     "tax_breakdown" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "tax_total" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "vat_category" "VatCategory" NOT NULL DEFAULT 'reduced',
ADD COLUMN     "vat_category_reviewed" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "products_vat_category_reviewed_idx" ON "products"("vat_category_reviewed");
