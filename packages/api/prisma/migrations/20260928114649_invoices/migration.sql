-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('draft', 'issued');

-- CreateEnum
CREATE TYPE "InvoiceKind" AS ENUM ('proforma', 'invoice', 'credit_note');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "fiscal_name" TEXT,
ADD COLUMN     "tax_id" TEXT;

-- CreateTable
CREATE TABLE "invoice_series" (
    "id" UUID NOT NULL,
    "series" VARCHAR(8) NOT NULL,
    "year" INTEGER NOT NULL,
    "last_number" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "kind" "InvoiceKind" NOT NULL DEFAULT 'proforma',
    "status" "InvoiceStatus" NOT NULL DEFAULT 'draft',
    "series" VARCHAR(8),
    "year" INTEGER,
    "number" INTEGER,
    "invoice_number" TEXT,
    "issue_date" TIMESTAMP(3),
    "order_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "seller_snapshot" JSONB NOT NULL,
    "buyer_snapshot" JSONB NOT NULL,
    "lines" JSONB NOT NULL,
    "totals" JSONB NOT NULL,
    "taxable_base" DECIMAL(10,2) NOT NULL,
    "vat_total" DECIMAL(10,2) NOT NULL,
    "total" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "payment_terms" TEXT,
    "notes" TEXT,
    "created_by_admin_id" UUID,
    "issued_by_admin_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoice_series_series_year_key" ON "invoice_series"("series", "year");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_invoice_number_key" ON "invoices"("invoice_number");

-- CreateIndex
CREATE INDEX "invoices_order_id_idx" ON "invoices"("order_id");

-- CreateIndex
CREATE INDEX "invoices_user_id_idx" ON "invoices"("user_id");

-- CreateIndex
CREATE INDEX "invoices_status_idx" ON "invoices"("status");

-- CreateIndex
CREATE INDEX "invoices_issue_date_idx" ON "invoices"("issue_date");

-- CreateIndex
CREATE INDEX "users_tax_id_idx" ON "users"("tax_id");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Guarantees Prisma cannot express ──────────────────────────────

-- One ISSUED invoice per order, enforced by the database rather than by an
-- application check the next code path forgets. Drafts are excluded so a
-- rejected draft can be replaced, and credit notes are excluded because a
-- rectified order legitimately has two documents.
CREATE UNIQUE INDEX "invoices_one_issued_per_order"
  ON "invoices"("order_id")
  WHERE "status" = 'issued' AND "kind" <> 'credit_note';

-- No two invoices may share a number within a series and year. The counter
-- row makes this unreachable; the index is what makes it true regardless.
CREATE UNIQUE INDEX "invoices_series_year_number"
  ON "invoices"("series", "year", "number")
  WHERE "number" IS NOT NULL;

-- An issued invoice must be complete. Catches any future code path that
-- flips status without allocating a number.
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_issued_is_complete"
  CHECK (
    "status" <> 'issued'
    OR ("series" IS NOT NULL AND "number" IS NOT NULL
        AND "invoice_number" IS NOT NULL AND "issue_date" IS NOT NULL)
  );

-- Immutability, at the database.
--
-- An application-level `if (status === 'issued') return 409` is necessary but
-- not sufficient: the next developer writes a second update path and the
-- guarantee is gone. A Spanish invoice cannot be altered once issued —
-- corrections go out as a credit note — so the rule belongs where no code
-- path can route around it.
--
-- `updated_at`, `notes` and future submission-status columns stay mutable so
-- operational metadata can still be recorded against an issued document.
CREATE OR REPLACE FUNCTION invoices_block_issued_mutation() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'issued' AND (
       NEW."lines"::text           IS DISTINCT FROM OLD."lines"::text
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

CREATE TRIGGER invoices_no_mutate_issued
  BEFORE UPDATE ON "invoices"
  FOR EACH ROW EXECUTE FUNCTION invoices_block_issued_mutation();

CREATE OR REPLACE FUNCTION invoices_block_issued_delete() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'issued' THEN
    RAISE EXCEPTION 'invoice % is issued and cannot be deleted', OLD."invoice_number";
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER invoices_no_delete_issued
  BEFORE DELETE ON "invoices"
  FOR EACH ROW EXECUTE FUNCTION invoices_block_issued_delete();
