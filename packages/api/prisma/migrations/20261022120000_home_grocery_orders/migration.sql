-- Home Grocery orders (2026-10-22). The plan becomes delivery settings only:
-- it makes no orders of its own. Every Home Grocery order is placed by the
-- household, by staff or by a rep, and picks its own slot — a day
-- (orders.scheduled_for, already there) and a part of that day. The plan's
-- frequency now reminds the household when its next order is due.
-- Additive, plus one index dropped. No data changes.

-- The part of the day an order is for. NULL = any time.
ALTER TABLE "orders" ADD COLUMN "delivery_window" "DeliveryWindow";

-- One live order per plan per date: needed while the plan made its own
-- drafts, wrong now — a household may place two orders for the same day.
DROP INDEX IF EXISTS "orders_plan_date_live_key";

-- The due date a plan was last reminded about, so the reminder goes once.
ALTER TABLE "rashan_subscriptions" ADD COLUMN "reminded_for" DATE;

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'home_grocery_order_due';
