-- Each order line's buying price (2026-10-27). Additive: a NOT NULL column
-- with a constant default, so every existing line reads 0 ("not entered")
-- without the table being rewritten. New lines copy the size's cost_price.
ALTER TABLE "order_items" ADD COLUMN "unit_cost" DECIMAL(10,2) NOT NULL DEFAULT 0;
