-- Single products an admin assigns a sales rep by hand, from any shop or
-- Cesto's own, on top of the shops they sell from (2026-10-27, lib/repStore).
--
-- Additive only: one new table. No existing row is read, changed or removed.
-- A row goes with its rep or its product.

-- CreateTable
CREATE TABLE "sales_rep_products" (
    "sales_rep_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_rep_products_pkey" PRIMARY KEY ("sales_rep_id","product_id")
);

-- CreateIndex
CREATE INDEX "sales_rep_products_product_id_idx" ON "sales_rep_products"("product_id");

-- AddForeignKey
ALTER TABLE "sales_rep_products" ADD CONSTRAINT "sales_rep_products_sales_rep_id_fkey" FOREIGN KEY ("sales_rep_id") REFERENCES "sales_reps"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_rep_products" ADD CONSTRAINT "sales_rep_products_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
