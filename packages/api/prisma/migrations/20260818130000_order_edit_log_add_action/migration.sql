-- ─── Order Edit Log: "add item" action ──────────────────────
-- Edit Order originally only supported changing quantity, replacing, or
-- removing an existing line item. Adding a brand-new item wasn't in v1
-- scope but turned out to be needed too — this adds the enum value so
-- editOrder.ts can create an OrderItem with no prior order_item_id and
-- log it the same way as every other edit action.

-- AlterEnum
ALTER TYPE "OrderEditAction" ADD VALUE 'add';
