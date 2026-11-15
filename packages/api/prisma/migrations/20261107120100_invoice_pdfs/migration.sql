-- The exact PDF of an issued factura or albarán (2026-11-07).
--
-- Additive: a new table, written to only by the new routes. Its own table rather
-- than columns on `invoices`, so a document's storage path never travels with the
-- invoice payloads every other screen reads. One row per document, never replaced.
CREATE TABLE "invoice_pdfs" (
    "invoice_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "saved_by_admin_id" UUID,
    "saved_by_sales_rep_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_pdfs_pkey" PRIMARY KEY ("invoice_id")
);

ALTER TABLE "invoice_pdfs"
    ADD CONSTRAINT "invoice_pdfs_invoice_id_fkey"
    FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
