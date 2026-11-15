-- Home Grocery plan notifications (2026-10-21). Additive: two enum values.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'home_grocery_delivery_planned';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'admin_home_grocery_plan';
