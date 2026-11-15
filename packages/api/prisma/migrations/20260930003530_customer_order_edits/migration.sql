-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'admin_order_edited';

-- AlterEnum
ALTER TYPE "OrderEditActor" ADD VALUE 'customer';

-- AlterTable
ALTER TABLE "order_edit_logs" ADD COLUMN     "editor_customer_id" UUID;

-- AddForeignKey
ALTER TABLE "order_edit_logs" ADD CONSTRAINT "order_edit_logs_editor_customer_id_fkey" FOREIGN KEY ("editor_customer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
