-- Recargo de equivalencia (2026-11-04).
--
-- A customer under the regime pays a surcharge on top of IVA, on the same
-- taxable base: 0,5 / 1,4 / 5,2 % for 4 / 10 / 21 % IVA. Set per customer by
-- an admin, copied onto each order when it is placed, charged on the order
-- (or once on a split purchase), and printed on the factura.
--
-- Additive: every existing row is "not under the regime, nothing charged".

ALTER TABLE "users" ADD COLUMN "recargo_equivalencia" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "orders" ADD COLUMN "recargo_equivalencia" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "orders" ADD COLUMN "recargo" DECIMAL(10,2) NOT NULL DEFAULT 0;

ALTER TABLE "parent_orders" ADD COLUMN "recargo_equivalencia" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "parent_orders" ADD COLUMN "recargo" DECIMAL(10,2) NOT NULL DEFAULT 0;

ALTER TABLE "invoices" ADD COLUMN "recargo_total" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "invoices" ADD COLUMN "recargo_equivalencia" BOOLEAN NOT NULL DEFAULT false;

-- An issued document's recargo is as frozen as the rest of it. Same function
-- as 20261104120000_invoice_hidden_lines, two columns more.
CREATE OR REPLACE FUNCTION invoices_block_issued_mutation() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'issued' AND (
       NEW."lines"::text                IS DISTINCT FROM OLD."lines"::text
    OR NEW."hidden_lines"::text         IS DISTINCT FROM OLD."hidden_lines"::text
    OR NEW."totals"::text               IS DISTINCT FROM OLD."totals"::text
    OR NEW."seller_snapshot"::text      IS DISTINCT FROM OLD."seller_snapshot"::text
    OR NEW."buyer_snapshot"::text       IS DISTINCT FROM OLD."buyer_snapshot"::text
    OR NEW."taxable_base"               IS DISTINCT FROM OLD."taxable_base"
    OR NEW."vat_total"                  IS DISTINCT FROM OLD."vat_total"
    OR NEW."recargo_total"              IS DISTINCT FROM OLD."recargo_total"
    OR NEW."recargo_equivalencia"       IS DISTINCT FROM OLD."recargo_equivalencia"
    OR NEW."total"                      IS DISTINCT FROM OLD."total"
    OR NEW."invoice_number"             IS DISTINCT FROM OLD."invoice_number"
    OR NEW."series"                     IS DISTINCT FROM OLD."series"
    OR NEW."number"                     IS DISTINCT FROM OLD."number"
    OR NEW."issue_date"                 IS DISTINCT FROM OLD."issue_date"
    OR NEW."kind"                       IS DISTINCT FROM OLD."kind"
    OR NEW."status"                     IS DISTINCT FROM OLD."status"
  ) THEN
    RAISE EXCEPTION 'invoice % is issued and cannot be altered', OLD."invoice_number";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
