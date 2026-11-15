-- Lines the office leaves off a document on purpose (2026-11-04).
--
-- Kept beside the printed lines rather than flagged among them, so `lines`
-- stays exactly what the paper says and nothing that prints or totals a
-- document has to remember to filter. Additive: every existing document has
-- nothing hidden.
ALTER TABLE "invoices" ADD COLUMN "hidden_lines" JSONB NOT NULL DEFAULT '[]';

-- An issued document's record of what was left off is as frozen as the rest
-- of it. Same function as 20260928114649_invoices, one column more.
CREATE OR REPLACE FUNCTION invoices_block_issued_mutation() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'issued' AND (
       NEW."lines"::text           IS DISTINCT FROM OLD."lines"::text
    OR NEW."hidden_lines"::text    IS DISTINCT FROM OLD."hidden_lines"::text
    OR NEW."totals"::text          IS DISTINCT FROM OLD."totals"::text
    OR NEW."seller_snapshot"::text IS DISTINCT FROM OLD."seller_snapshot"::text
    OR NEW."buyer_snapshot"::text  IS DISTINCT FROM OLD."buyer_snapshot"::text
    OR NEW."taxable_base"          IS DISTINCT FROM OLD."taxable_base"
    OR NEW."vat_total"             IS DISTINCT FROM OLD."vat_total"
    OR NEW."total"                 IS DISTINCT FROM OLD."total"
    OR NEW."invoice_number"        IS DISTINCT FROM OLD."invoice_number"
    OR NEW."series"                IS DISTINCT FROM OLD."series"
    OR NEW."number"                IS DISTINCT FROM OLD."number"
    OR NEW."issue_date"            IS DISTINCT FROM OLD."issue_date"
    OR NEW."kind"                  IS DISTINCT FROM OLD."kind"
    OR NEW."status"                IS DISTINCT FROM OLD."status"
  ) THEN
    RAISE EXCEPTION 'invoice % is issued and cannot be altered', OLD."invoice_number";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
