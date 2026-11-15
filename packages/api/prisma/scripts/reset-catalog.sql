-- One-off cleanup: wipe the catalog (products + categories) and any orders
-- referencing it. CASCADE picks up the dependent tables (variants, images,
-- subcategories, order_items, subscription_deliveries).
-- The pending_products table is conditional because this script may run
-- before the matching migration has been applied.
DO $$
DECLARE
  tables text;
BEGIN
  tables := '"orders","products","categories","pending_categories"';
  IF to_regclass('public.pending_products') IS NOT NULL THEN
    tables := tables || ',"pending_products"';
  END IF;
  EXECUTE 'TRUNCATE TABLE ' || tables || ' RESTART IDENTITY CASCADE';
END $$;
