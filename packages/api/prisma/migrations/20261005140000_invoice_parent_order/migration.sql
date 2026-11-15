-- One document per PURCHASE, not per shop.
--
-- A split purchase is one ParentOrder with a sub-Order per shop. Invoices
-- hung off Order alone, so a customer who bought from three shops got three
-- albaranes and three facturas for one basket — and on production that is the
-- normal case, not the exception: 114 of 143 orders are sub-orders of 28
-- split purchases, and two of them have already been invoiced separately.
--
-- So an invoice now belongs to EITHER one order or one whole purchase.
ALTER TABLE "invoices" ALTER COLUMN "order_id" DROP NOT NULL;
ALTER TABLE "invoices" ADD COLUMN "parent_order_id" UUID;

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_parent_order_id_fkey"
  FOREIGN KEY ("parent_order_id") REFERENCES "parent_orders"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Exactly one of the two, never both and never neither. Without this a row
-- could claim to be about a single order AND a whole purchase, and every
-- query that sums invoices would double count it.
ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_one_subject"
  CHECK (("order_id" IS NULL) <> ("parent_order_id" IS NULL));

CREATE INDEX "invoices_parent_order_id_idx" ON "invoices"("parent_order_id");

-- The same "one issued factura" rule the per-order index already enforces,
-- for the purchase-level document.
CREATE UNIQUE INDEX "invoices_one_issued_factura_per_parent"
  ON "invoices"("parent_order_id")
  WHERE "status" = 'issued' AND "kind" = 'invoice';
