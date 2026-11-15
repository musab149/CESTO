-- Rename, not add-and-backfill. Every existing row keeps its identity: a
-- stored "proforma" was already a non-fiscal, reissuable document with its own
-- number series, which is exactly what an albarán is. Only the name was wrong.
--
-- Issued documents keep whatever number they were allocated. An issued
-- document's number is the one thing that must never be rewritten, so old
-- PR-2026-00001 rows stay PR-2026-00001 and new ones take the ALB series.
--
-- Guarded so it is safe to re-run and safe to land on a branch that already
-- has it — the same lesson as 2026-08-31, where a migration that could not be
-- re-run P3009-blocked everything behind it.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'InvoiceKind' AND e.enumlabel = 'proforma'
  ) THEN
    ALTER TYPE "InvoiceKind" RENAME VALUE 'proforma' TO 'albaran';
  END IF;
END $$;
