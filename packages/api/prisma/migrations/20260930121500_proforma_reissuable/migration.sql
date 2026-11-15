-- Let a proforma be reissued; keep exactly one factura per order.
--
-- The old index allowed ONE issued non-credit-note per order, which made
-- sense while every document was treated as fiscal. It stopped making sense
-- the moment a proforma stopped freezing its order: the order can now change
-- after a proforma has gone out, and the whole point of a proforma is that
-- you reissue it when it does. Under the old index the rep was stuck with a
-- document that no longer matched the order and no way to replace it.
--
-- A proforma is a quote, so several per order is correct — the latest
-- supersedes the earlier ones. A FACTURA is a fiscal document and must stay
-- exactly one per sale, which is what the new index still guarantees.
--
-- PERMISSIVE CHANGE: it only ever allows rows the old index refused, so a
-- migrated database keeps working under an older API bundle (that bundle's
-- own application-level check still blocks a second document). The reverse
-- order would not be safe, but Render applies migrations before starting the
-- new API, so the new code never runs against the old index.

DROP INDEX "invoices_one_issued_per_order";

CREATE UNIQUE INDEX "invoices_one_issued_factura_per_order"
  ON "invoices"("order_id")
  WHERE "status" = 'issued' AND "kind" = 'invoice';
