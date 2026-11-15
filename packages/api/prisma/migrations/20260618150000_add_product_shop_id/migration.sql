-- AlterTable
ALTER TABLE "products" ADD COLUMN "shop_id" TEXT;

-- CreateIndex
CREATE INDEX "products_shop_id_idx" ON "products"("shop_id");

-- AlterTable
ALTER TABLE "pending_products" ADD COLUMN "shop_id" TEXT;
