-- Remove the delivery-coverage system.
--
-- DESTRUCTIVE AND IRREVERSIBLE. Drops two tables and four columns. There is
-- no down migration; restoring this data means restoring a backup.
--
-- What is being removed and why:
--
--   delivery_zones / delivery_slots
--     Zones did three unrelated jobs — postcode service area, delivery fee,
--     free-delivery threshold — which made coverage a precondition for
--     trading. Stores could not publish without a zone, customers could not
--     save an address outside one, and checkout refused cart items whose
--     store did not cover the delivery postcode. Every live store now sells
--     everywhere. The fee and threshold move to AppSetting["store"] as
--     `deliveryFee` / `freeDeliveryMin` (JSON, no migration).
--
--   orders.delivery_slot_id
--     Booked windows are gone; every order is ASAP. This DOES erase the
--     booked window from historical orders — the slot was never snapshotted
--     onto the order row, so it cannot be preserved. Accepted deliberately:
--     only the mobile client ever set one.
--
--   addresses.zone_id
--     Served only to answer "is this address serviceable", which no longer
--     has a meaning.
--
--   users.browse_postcode
--     The postcode a customer browsed as. Nothing filters on location now.
--
--   banners.target_zone
--     Zone-targeted banners. Never wired to a UI; every banner is global.
--
-- Order matters: the FK-holding columns go before the tables they point at,
-- so no constraint is left dangling mid-migration.

-- 1. Columns holding FKs into the zone/slot tables.
ALTER TABLE "orders"    DROP COLUMN IF EXISTS "delivery_slot_id";
ALTER TABLE "addresses" DROP COLUMN IF EXISTS "zone_id";

-- 2. The tables themselves. delivery_slots first — it FKs to delivery_zones.
DROP TABLE IF EXISTS "delivery_slots";
DROP TABLE IF EXISTS "delivery_zones";

-- 3. The day-of-week enum existed only for delivery_slots.day_of_week.
--    Store opening hours are a JSON blob and do not use it.
DROP TYPE IF EXISTS "DayOfWeek";

-- 4. Columns with no FK, dropped for the same reason.
ALTER TABLE "users"   DROP COLUMN IF EXISTS "browse_postcode";
ALTER TABLE "banners" DROP COLUMN IF EXISTS "target_zone";

-- 5. A store's physical trading address, shown on the storefront beside its
--    country. Free text: nothing filters, routes or prices on it.
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "address" TEXT;
