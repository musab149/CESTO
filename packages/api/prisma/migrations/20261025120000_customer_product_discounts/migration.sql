-- Per-customer product discounts (2026-10-25): euros off ONE unit of one
-- product size, set by staff or a rep on an order and remembered for that
-- customer. Purely additive: a nullable column and a new table. Nothing is
-- backfilled — orders discounted before keep their flat line figures.

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "unit_discount" DECIMAL(10,2);

-- CreateTable
CREATE TABLE "customer_product_discounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "order_id" UUID,
    "set_by_admin_id" UUID,
    "set_by_sales_rep_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_product_discounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_product_discounts_variant_id_idx" ON "customer_product_discounts"("variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_product_discounts_user_id_variant_id_key" ON "customer_product_discounts"("user_id", "variant_id");

-- AddForeignKey
ALTER TABLE "customer_product_discounts" ADD CONSTRAINT "customer_product_discounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_product_discounts" ADD CONSTRAINT "customer_product_discounts_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_product_discounts" ADD CONSTRAINT "customer_product_discounts_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_product_discounts" ADD CONSTRAINT "customer_product_discounts_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
