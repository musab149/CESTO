-- MV Slice 5: the postcode a customer is BROWSING as.
--
-- NULL means "Global" - show every live store regardless of whether it can
-- deliver there. Deliberately not an Address FK: guests browse with no
-- address, and a logged-in customer may want to look at a different area
-- from their default delivery address. Address.zone_id remains the authority
-- for what is actually deliverable; checkout re-validates against the chosen
-- ADDRESS, never against this column.
--
-- Additive, nullable, no backfill. Every existing user defaults to Global,
-- which is exactly the pre-Slice-5 behaviour.

ALTER TABLE "users" ADD COLUMN "browse_postcode" TEXT;
