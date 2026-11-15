-- Home Grocery plans (2026-10-21).
--
-- An approved Home Grocery household keeps a standing list and a schedule;
-- each delivery is made ahead as a real `draft` order (no stock held) that
-- staff confirm when they start preparing it. ADDITIVE ONLY: two enum values,
-- one new enum, nullable columns, a FK that sets null, and indexes.

-- Plan frequencies in weeks, matching the request form. `monthly` is read as
-- 4 weeks by the plan code; `every_6_weeks` stays for legacy subscriptions.
ALTER TYPE "RashanFrequency" ADD VALUE IF NOT EXISTS 'weekly';
ALTER TYPE "RashanFrequency" ADD VALUE IF NOT EXISTS 'every_3_weeks';

CREATE TYPE "DeliveryWindow" AS ENUM ('morning', 'afternoon', 'evening');

ALTER TABLE "rashan_subscriptions"
  ADD COLUMN "preferred_weekday" INTEGER,
  ADD COLUMN "preferred_window" "DeliveryWindow",
  ADD COLUMN "notify_before" BOOLEAN NOT NULL DEFAULT true;

-- ISO weekday: 1 = Monday … 7 = Sunday.
ALTER TABLE "rashan_subscriptions"
  ADD CONSTRAINT "rashan_subscriptions_preferred_weekday_check"
  CHECK ("preferred_weekday" IS NULL OR "preferred_weekday" BETWEEN 1 AND 7);

ALTER TABLE "orders"
  ADD COLUMN "rashan_subscription_id" UUID,
  ADD COLUMN "scheduled_for" DATE;

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_rashan_subscription_id_fkey"
  FOREIGN KEY ("rashan_subscription_id") REFERENCES "rashan_subscriptions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "orders_rashan_subscription_id_idx" ON "orders"("rashan_subscription_id");

-- One live order per plan per date. Two requests making "the next delivery"
-- at the same moment compute the same date; this lets exactly one insert win.
-- Cancelled and deleted orders do not count, so a skipped date can be planned
-- again after a pause. Prisma cannot model a partial index: `migrate diff`
-- reports it as drift. Do not drop it.
CREATE UNIQUE INDEX "orders_plan_date_live_key"
  ON "orders" ("rashan_subscription_id", "scheduled_for")
  WHERE "rashan_subscription_id" IS NOT NULL
    AND "status" <> 'cancelled'
    AND "deleted_at" IS NULL;
