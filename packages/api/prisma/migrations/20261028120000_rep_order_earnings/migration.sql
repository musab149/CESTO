-- A rep's earnings come from each order they build (2026-10-28, user: "Now
-- the earnings of the reps will be calculated from the orders... Within
-- earnings we need to have the history maintained about owed amount and paid
-- amount... So change the current according to this one").
--
-- Additive: one enum type, four notification types, three new tables, and
-- rows copied INTO the new ledger. No existing table, column or row is changed
-- or removed — the period statements stay where they are, unread from now on.

-- CreateEnum
CREATE TYPE "SalesRepLedgerKind" AS ENUM ('order_earning', 'order_adjustment', 'order_reversal', 'order_not_earned', 'adjustment', 'payout', 'payout_void', 'legacy_statement');

-- AlterEnum (not used below, so safe inside this migration's transaction)
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'rep_earning_approved';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'rep_earning_reversed';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'rep_earning_adjusted';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'rep_payout_recorded';

-- CreateTable
CREATE TABLE "sales_rep_order_earnings" (
    "order_id" UUID NOT NULL,
    "sales_rep_id" UUID NOT NULL,
    "commission_pct" DECIMAL(5,2),
    "approved_at" TIMESTAMP(3),
    "approved_by_admin_id" UUID,
    "approved_sales" DECIMAL(12,2),
    "approved_buying" DECIMAL(12,2),
    "approved_expenses" DECIMAL(12,2),
    "approved_expense_items" JSONB,
    "approved_pct" DECIMAL(5,2),
    "approved_earning" DECIMAL(12,2),
    "reversed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_rep_order_earnings_pkey" PRIMARY KEY ("order_id")
);

-- CreateTable
CREATE TABLE "sales_rep_order_expenses" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sales_rep_order_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_rep_ledger_entries" (
    "id" UUID NOT NULL,
    "sales_rep_id" UUID NOT NULL,
    "kind" "SalesRepLedgerKind" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reference_amount" DECIMAL(12,2),
    "order_id" UUID,
    "order_number" TEXT,
    "occurred_on" DATE NOT NULL,
    "note" TEXT,
    "dedupe_key" TEXT,
    "voids_entry_id" UUID,
    "created_by_admin_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_rep_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_rep_order_earnings_sales_rep_id_idx" ON "sales_rep_order_earnings"("sales_rep_id");

-- CreateIndex
CREATE INDEX "sales_rep_order_expenses_order_id_idx" ON "sales_rep_order_expenses"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_rep_ledger_entries_dedupe_key_key" ON "sales_rep_ledger_entries"("dedupe_key");

-- CreateIndex
CREATE INDEX "sales_rep_ledger_entries_sales_rep_id_created_at_idx" ON "sales_rep_ledger_entries"("sales_rep_id", "created_at");

-- CreateIndex
CREATE INDEX "sales_rep_ledger_entries_order_id_idx" ON "sales_rep_ledger_entries"("order_id");

-- AddForeignKey
ALTER TABLE "sales_rep_order_earnings" ADD CONSTRAINT "sales_rep_order_earnings_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_rep_order_earnings" ADD CONSTRAINT "sales_rep_order_earnings_sales_rep_id_fkey" FOREIGN KEY ("sales_rep_id") REFERENCES "sales_reps"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_rep_order_expenses" ADD CONSTRAINT "sales_rep_order_expenses_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "sales_rep_order_earnings"("order_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_rep_ledger_entries" ADD CONSTRAINT "sales_rep_ledger_entries_sales_rep_id_fkey" FOREIGN KEY ("sales_rep_id") REFERENCES "sales_reps"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_rep_ledger_entries" ADD CONSTRAINT "sales_rep_ledger_entries_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── The period statements, carried into the ledger ─────────────────────
-- Every published or paid statement becomes what it was worth to the rep —
-- percentage × (profit − expenses), never below zero, to the cent, as
-- lib/repEarnings worked it out — so what was owed stays owed. A paid one
-- is also paid out, on the day it was paid. Drafts were never the rep's and
-- are not carried. The dedupe keys make this safe to run twice.

INSERT INTO "sales_rep_ledger_entries"
  ("id", "sales_rep_id", "kind", "amount", "occurred_on", "note", "dedupe_key", "created_by_admin_id", "created_at")
SELECT
  gen_random_uuid(),
  v."sales_rep_id",
  'legacy_statement'::"SalesRepLedgerKind",
  v."earning",
  v."period_to",
  'Liquidación ' || to_char(v."period_from", 'DD/MM/YYYY') || ' – ' || to_char(v."period_to", 'DD/MM/YYYY')
    || COALESCE(' · ' || NULLIF(btrim(v."notes"), ''), ''),
  'legacy:' || v."id",
  v."created_by_admin_id",
  v."updated_at"
FROM (
  SELECT st.*,
    CASE WHEN st."profit" - COALESCE(x."total", 0) <= 0 THEN 0
         ELSE ROUND((st."profit" - COALESCE(x."total", 0)) * st."percentage" / 100, 2) END AS "earning"
  FROM "sales_rep_statements" st
  LEFT JOIN (SELECT "statement_id", SUM("amount") AS "total" FROM "sales_rep_statement_expenses" GROUP BY "statement_id") x
    ON x."statement_id" = st."id"
  WHERE st."status" IN ('published', 'paid')
) v
ON CONFLICT ("dedupe_key") DO NOTHING;

INSERT INTO "sales_rep_ledger_entries"
  ("id", "sales_rep_id", "kind", "amount", "occurred_on", "note", "dedupe_key", "created_by_admin_id", "created_at")
SELECT
  gen_random_uuid(),
  v."sales_rep_id",
  'payout'::"SalesRepLedgerKind",
  -v."earning",
  COALESCE(v."paid_at", v."period_to"),
  'Pago de la liquidación ' || to_char(v."period_from", 'DD/MM/YYYY') || ' – ' || to_char(v."period_to", 'DD/MM/YYYY'),
  'legacy-paid:' || v."id",
  v."created_by_admin_id",
  v."updated_at" + interval '1 millisecond'
FROM (
  SELECT st.*,
    CASE WHEN st."profit" - COALESCE(x."total", 0) <= 0 THEN 0
         ELSE ROUND((st."profit" - COALESCE(x."total", 0)) * st."percentage" / 100, 2) END AS "earning"
  FROM "sales_rep_statements" st
  LEFT JOIN (SELECT "statement_id", SUM("amount") AS "total" FROM "sales_rep_statement_expenses" GROUP BY "statement_id") x
    ON x."statement_id" = st."id"
  WHERE st."status" = 'paid'
) v
WHERE v."earning" > 0
ON CONFLICT ("dedupe_key") DO NOTHING;
