-- Sales rep earnings (2026-10-26, user request): statements for dates an admin
-- picks, with the profit and expenses the admin enters and the rep's
-- percentage; reps see published and paid ones. Plus when an order was
-- delivered, which the statements count by. Additive: a new enum type, a new
-- nullable column on orders and on sales_reps, two new tables.

-- CreateEnum
CREATE TYPE "SalesRepStatementStatus" AS ENUM ('draft', 'published', 'paid');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "delivered_at" TIMESTAMP(3);

-- Orders delivered before now: their last update is the closest record of
-- when that happened.
UPDATE "orders" SET "delivered_at" = "updated_at" WHERE "status" = 'delivered' AND "delivered_at" IS NULL;

-- AlterTable
ALTER TABLE "sales_reps" ADD COLUMN     "commission_pct" DECIMAL(5,2);

-- CreateTable
CREATE TABLE "sales_rep_statements" (
    "id" UUID NOT NULL,
    "sales_rep_id" UUID NOT NULL,
    "period_from" DATE NOT NULL,
    "period_to" DATE NOT NULL,
    "profit" DECIMAL(12,2) NOT NULL,
    "percentage" DECIMAL(5,2) NOT NULL,
    "status" "SalesRepStatementStatus" NOT NULL DEFAULT 'draft',
    "paid_at" DATE,
    "notes" TEXT,
    "created_by_admin_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_rep_statements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_rep_statement_expenses" (
    "id" UUID NOT NULL,
    "statement_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sales_rep_statement_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_rep_statements_sales_rep_id_period_from_idx" ON "sales_rep_statements"("sales_rep_id", "period_from");

-- CreateIndex
CREATE INDEX "sales_rep_statement_expenses_statement_id_idx" ON "sales_rep_statement_expenses"("statement_id");

-- AddForeignKey
ALTER TABLE "sales_rep_statements" ADD CONSTRAINT "sales_rep_statements_sales_rep_id_fkey" FOREIGN KEY ("sales_rep_id") REFERENCES "sales_reps"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_rep_statement_expenses" ADD CONSTRAINT "sales_rep_statement_expenses_statement_id_fkey" FOREIGN KEY ("statement_id") REFERENCES "sales_rep_statements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
