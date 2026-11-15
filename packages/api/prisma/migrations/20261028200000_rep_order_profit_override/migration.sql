-- A profit an admin types in by hand on a rep's order (2026-10-28,
-- lib/repEarnings): the gross profit (expenses still come off) or the net
-- profit (buying prices and expenses not counted), who set it and when, and
-- the same as approved.
--
-- Additive only: a NEW enum type (not ADD VALUE) and six nullable columns.
-- No existing row is read or changed; every order keeps its worked-out profit.

-- CreateEnum
CREATE TYPE "RepProfitBasis" AS ENUM ('gross', 'net');

-- AlterTable
ALTER TABLE "sales_rep_order_earnings" ADD COLUMN     "approved_profit" DECIMAL(12,2),
ADD COLUMN     "approved_profit_basis" "RepProfitBasis",
ADD COLUMN     "profit_basis" "RepProfitBasis",
ADD COLUMN     "profit_override" DECIMAL(12,2),
ADD COLUMN     "profit_set_at" TIMESTAMP(3),
ADD COLUMN     "profit_set_by_admin_id" UUID;

-- AddForeignKey
ALTER TABLE "sales_rep_order_earnings" ADD CONSTRAINT "sales_rep_order_earnings_profit_set_by_admin_id_fkey" FOREIGN KEY ("profit_set_by_admin_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;
