-- A document a sales rep drafted or issued, recorded as theirs.
--
-- Mirrors the pair that was already here for admins, including the absence of
-- a foreign key. That is deliberate on a fiscal document: ON DELETE SET NULL
-- would quietly erase who issued a factura the day their account was removed,
-- and a factura is a record of who did what, kept for years after.
--
-- Entirely additive. Both columns are null on every existing row, which reads
-- correctly: nothing before this was issued by a rep.
ALTER TABLE "invoices" ADD COLUMN "created_by_sales_rep_id" UUID;
ALTER TABLE "invoices" ADD COLUMN "issued_by_sales_rep_id"  UUID;

-- Answering "what has this rep issued" without scanning the table.
CREATE INDEX "invoices_issued_by_sales_rep_id_idx" ON "invoices"("issued_by_sales_rep_id");
