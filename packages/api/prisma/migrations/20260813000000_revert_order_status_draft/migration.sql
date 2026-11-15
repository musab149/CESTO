-- ─── Order status: revert 'draft' ────────────────────────────
-- Undoes 20260807120000_order_status_draft. The out-of-stock draft-order
-- feature was reverted in application code (commit d1d0aa1) and
-- schema.prisma no longer declares either value; this migration catches
-- the database up. Postgres has no ALTER TYPE ... DROP VALUE, so both
-- enums are recreated without the retired value and every dependent
-- column is repointed at the new type.
--
-- Safe to run: confirmed no `orders.status = 'draft'` or
-- `notifications.type = 'admin_draft_order'` rows exist before this ran
-- (the one leftover test row of each was deleted manually first).

ALTER TYPE "OrderStatus" RENAME TO "OrderStatus_old";
CREATE TYPE "OrderStatus" AS ENUM ('pending', 'confirmed', 'preparing', 'on_the_way', 'delivered', 'cancelled', 'partially_completed');
ALTER TABLE "orders" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "orders" ALTER COLUMN "status" TYPE "OrderStatus" USING ("status"::text::"OrderStatus");
ALTER TABLE "orders" ALTER COLUMN "status" SET DEFAULT 'pending';
DROP TYPE "OrderStatus_old";

ALTER TYPE "NotificationType" RENAME TO "NotificationType_old";
CREATE TYPE "NotificationType" AS ENUM ('order_confirmed', 'order_preparing', 'order_on_the_way', 'order_delivered', 'order_cancelled', 'promo_banner', 'admin_new_order', 'admin_low_stock', 'admin_new_customer', 'admin_subscription_paused', 'admin_broadcast');
ALTER TABLE "notifications" ALTER COLUMN "type" TYPE "NotificationType" USING ("type"::text::"NotificationType");
DROP TYPE "NotificationType_old";
