-- DropForeignKey
ALTER TABLE "orders" DROP CONSTRAINT "orders_delivery_slot_id_fkey";

-- AlterTable
ALTER TABLE "orders" ALTER COLUMN "delivery_slot_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_delivery_slot_id_fkey" FOREIGN KEY ("delivery_slot_id") REFERENCES "delivery_slots"("id") ON DELETE SET NULL ON UPDATE CASCADE;
