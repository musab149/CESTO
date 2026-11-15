-- ─── Order Edit Log ─────────────────────────────────────────
-- Structured audit trail for the Edit Order feature (partner/admin can
-- change a line item's quantity, replace it, or remove it after checkout).
-- One row per line-item action within a single edit "save" — a save that
-- changes 3 items writes 3 rows, all inside the same $transaction as the
-- item/stock/total mutations, so a log row can never exist without the
-- edit it describes having actually landed.
--
-- order_item_id is deliberately NOT a foreign key: when an item is removed
-- the OrderItem row is deleted, but its edit history must survive. Always
-- query by order_id, never by joining through order_items.
--
-- All additive, no backfill needed.

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'order_edited';

-- CreateEnum
CREATE TYPE "OrderEditAction" AS ENUM ('update_qty', 'replace', 'remove');

-- CreateEnum
CREATE TYPE "OrderEditActor" AS ENUM ('admin', 'partner');

-- CreateTable
CREATE TABLE "order_edit_logs" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "action" "OrderEditAction" NOT NULL,
    "old_quantity" INTEGER,
    "new_quantity" INTEGER,
    "old_product_id" UUID,
    "old_variant_id" UUID,
    "old_snapshot" JSONB,
    "new_product_id" UUID,
    "new_variant_id" UUID,
    "new_snapshot" JSONB,
    "old_line_total" DECIMAL(10,2),
    "new_line_total" DECIMAL(10,2),
    "note" TEXT,
    "editor_type" "OrderEditActor" NOT NULL,
    "editor_admin_id" UUID,
    "editor_partner_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_edit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_edit_logs_order_id_created_at_idx" ON "order_edit_logs"("order_id", "created_at");

-- AddForeignKey
ALTER TABLE "order_edit_logs" ADD CONSTRAINT "order_edit_logs_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_edit_logs" ADD CONSTRAINT "order_edit_logs_editor_admin_id_fkey" FOREIGN KEY ("editor_admin_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_edit_logs" ADD CONSTRAINT "order_edit_logs_editor_partner_user_id_fkey" FOREIGN KEY ("editor_partner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
