-- Corrective: an Address must never point at a PARTNER delivery zone.
--
-- routes/addresses.ts and /api/zones/check both resolve an address's zone with
-- `store_id IS NULL`, i.e. platform zones only. lib/zoneResolver.ts did not --
-- it indexed every active zone. So any zone mutation (a partner editing their
-- area, or an admin using the new store-zones tab) could re-bind an address to
-- whichever store happened to list that postcode first.
--
-- That matters because Address.zone_id is where checkout reads `delivery_fee`
-- and `free_delivery_min`. A mis-bound address charges the customer a
-- particular partner's delivery terms — including on orders that partner has
-- nothing to do with — and the binding changes silently whenever that partner
-- edits their zone.
--
-- Setting zone_id to NULL returns those addresses to "no platform zone covers
-- this postcode", which is the truth. The customer is asked to pick a
-- serviceable address at checkout instead of being quoted someone else's fee.
-- Once a platform zone covering the postcode exists, the next
-- refreshAddressZones pass binds them correctly.
--
-- Idempotent, and a no-op anywhere addresses were already bound correctly --
-- including production, where partner zones did not exist before this slice.

UPDATE "addresses" a
SET zone_id = NULL
FROM "delivery_zones" z
WHERE a.zone_id = z.id
  AND z.store_id IS NOT NULL;
