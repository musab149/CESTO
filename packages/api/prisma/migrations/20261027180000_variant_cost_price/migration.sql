-- The buying price of each size (2026-10-27). Additive: a NOT NULL column
-- with a constant default, so every existing size reads 0 ("not entered yet")
-- without the table being rewritten.
ALTER TABLE "product_variants" ADD COLUMN "cost_price" DECIMAL(10,2) NOT NULL DEFAULT 0;
