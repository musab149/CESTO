-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "created_by_admin_id" UUID;

-- CreateIndex
CREATE INDEX "orders_created_by_admin_id_idx" ON "orders"("created_by_admin_id");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_admin_id_fkey" FOREIGN KEY ("created_by_admin_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;
