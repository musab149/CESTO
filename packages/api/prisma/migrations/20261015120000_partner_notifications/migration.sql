-- Partners get an inbox of their own, and a customer hears when our team
-- builds an order for them.
--
-- Additive only: one audience and five notification types. No table or
-- column changes, and no existing row is touched.

ALTER TYPE "NotificationAudience" ADD VALUE IF NOT EXISTS 'partner';

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'order_placed';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'partner_new_order';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'partner_draft_order';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'partner_order_edited';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'partner_order_cancelled';
