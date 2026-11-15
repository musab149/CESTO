-- Store.country: the market a store TRADES IN (where it delivers), as an
-- ISO 3166-1 alpha-2 code. Not to be confused with Store.origin, which is the
-- heritage of the goods - a Pakistani grocer trading in Madrid is
-- country='ES', origin='Pakistan'.
--
-- GROUNDWORK ONLY. Nothing filters on this yet and there is no customer
-- facing country picker. A second delivery market needs far more than a
-- filter: there is no currency field anywhere in the schema, prices are bare
-- Decimals with EUR assumed across ~27 web files and both importer
-- templates, and payment rails, tax and invoicing are all Spain-shaped.
-- Shipping a picker before that would visibly filter while silently
-- mispricing everything outside Spain.
--
-- Landing the column now means the eventual switch-on is a filter change
-- rather than a backfill across every store.
--
-- Additive with a default, so every existing store becomes 'ES' - which is
-- accurate today.

-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "country" VARCHAR(2) NOT NULL DEFAULT 'ES';

-- CreateIndex
CREATE INDEX "stores_country_idx" ON "stores"("country");

