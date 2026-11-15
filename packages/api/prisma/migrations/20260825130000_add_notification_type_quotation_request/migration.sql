-- Adds the admin-feed notification type for quotation-request leads so the
-- admin bell dropdown can surface them (mirrors admin_draft_order / admin_new_order).

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'admin_quotation_request';
