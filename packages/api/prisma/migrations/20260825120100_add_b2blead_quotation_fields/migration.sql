-- Additive: nullable columns for the new 'quotation' B2bLead type (product
-- quotation requests from the product detail page). No backfill needed —
-- existing rows simply have NULLs here, which is correct for non-quotation
-- leads. No FK on quote_product_id: a lead must stay readable even if the
-- product referenced is later deleted.
ALTER TABLE "b2b_leads" ADD COLUMN "quote_product_id" UUID;
ALTER TABLE "b2b_leads" ADD COLUMN "quote_product_name" TEXT;
ALTER TABLE "b2b_leads" ADD COLUMN "quote_quantity" INTEGER;
