-- Corrective: remove zero-postcode zones created by 20260728140000_backfill_store_zones.
--
-- That migration seeds each zoneless live store with the union of the PLATFORM
-- zones' postcodes. On a database with NO platform zones the union is an empty
-- array — and an empty array is not NULL, so the COALESCE guard never fires.
-- The result is a zone covering nothing.
--
-- That is worse than the state it replaced. Under Slice 5 rules a store with no
-- zones is UNRESTRICTED and serves everywhere; a store with a zone is limited to
-- that zone. Seeding an empty zone therefore flips a working store into one
-- reachable from nowhere, and it vanishes from the storefront the moment
-- MV_STOREFRONT is enabled. Staging hit this with three live stores.
--
-- Deleting the row restores the store to unrestricted, which is its correct
-- pre-Slice-5 behaviour.
--
-- Scope is deliberately narrow: only store-owned zones, only zero-postcode ones,
-- and only those still carrying the exact name the backfill assigns. A zone a
-- partner has since named or populated is never touched. Platform zones
-- (store_id IS NULL) are excluded outright.
--
-- Idempotent, and a no-op on any database where the backfill found platform
-- zones to copy — including local.
--
-- lib/location-scope.ts and lib/store-publish.ts now also ignore empty zones, so
-- this class of row is inert even if one is created some other way. This
-- migration cleans up the rows that already exist.

DELETE FROM "delivery_zones"
WHERE store_id IS NOT NULL
  AND cardinality(postcodes) = 0
  AND name = 'Default delivery area';
