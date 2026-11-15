-- AlterTable
ALTER TABLE "users" ADD COLUMN     "created_by_admin_id" UUID,
ADD COLUMN     "sales_manager_admin_id" UUID,
ADD COLUMN     "sales_manager_name" TEXT;

-- CreateIndex
CREATE INDEX "users_sales_manager_admin_id_idx" ON "users"("sales_manager_admin_id");

-- CreateIndex
CREATE INDEX "users_sales_manager_name_idx" ON "users"("sales_manager_name");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_sales_manager_admin_id_fkey" FOREIGN KEY ("sales_manager_admin_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_created_by_admin_id_fkey" FOREIGN KEY ("created_by_admin_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;
