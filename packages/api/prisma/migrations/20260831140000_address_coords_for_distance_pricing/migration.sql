-- Distance-based delivery pricing: give an address a position.
--
-- ADDITIVE AND SAFE. Four nullable columns, no data touched, no column or
-- table dropped. Rolling back means dropping these four again.
--
-- Why:
--   The flat platform delivery fee (AppSetting["store"].deliveryFee) charges
--   a customer 800 m away the same as one 40 km away. To vary the fee by
--   distance we need a distance, and after the zone removal nothing in the
--   schema carried a position at all — `addresses` had postcode/city/street
--   text and `stores.address` is explicitly free text that is never geocoded.
--
--   These columns hold the forward-geocoded position of the delivery
--   address. Distance is measured from one platform origin, also stored in
--   AppSetting["store"] (deliveryOriginLat / deliveryOriginLng), against an
--   admin-managed band table (deliveryBands). None of that needs a
--   migration — it is JSON in the settings blob, matching how deliveryFee
--   and freeDeliveryMin already live there.
--
-- Note this is NOT the zone system coming back. A zone was an admin-drawn
-- list of postcodes that decided both the price AND whether the customer
-- could order at all; these are a measured distance that only ever moves the
-- price along a ladder. Nothing is refused, and no bookkeeping decides who
-- is in which band.
--
-- Every column is nullable and every consumer treats null as "fall back to
-- the flat fee", so this migration deploying ahead of the API that reads it
-- changes nothing, and the API deploying ahead of a backfill also changes
-- nothing. Existing rows are geocoded lazily: the first delivery quote for
-- an address with no coordinates resolves and persists them.

ALTER TABLE "addresses" ADD COLUMN IF NOT EXISTS "latitude"          DOUBLE PRECISION;
ALTER TABLE "addresses" ADD COLUMN IF NOT EXISTS "longitude"         DOUBLE PRECISION;
ALTER TABLE "addresses" ADD COLUMN IF NOT EXISTS "geocoded_at"       TIMESTAMP(3);
ALTER TABLE "addresses" ADD COLUMN IF NOT EXISTS "geocode_failed_at" TIMESTAMP(3);
