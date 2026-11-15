-- Sales reps get an inbox of their own: a bell in the rep panel that says
-- when an admin publishes or pays a period of their earnings, and when an
-- order they built is delivered or cancelled.
--
-- Additive only: one audience and four notification types. No table or
-- column changes, and no existing row is touched.

ALTER TYPE "NotificationAudience" ADD VALUE IF NOT EXISTS 'sales_rep';

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'rep_statement_published';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'rep_statement_paid';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'rep_order_delivered';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'rep_order_cancelled';
