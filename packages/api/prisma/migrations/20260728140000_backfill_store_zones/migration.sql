-- MV Slice 5: give every live partner store a delivery zone.
--
-- A store may no longer go live without at least one active delivery zone
-- (see lib/store-publish.ts). Stores that went live before that rule existed
-- have none, and must not be left failing a rule that post-dates them - they
-- would keep working today only because location-scope.ts still treats
-- "no zones" permissively, and would break the moment that affordance is
-- removed in Slice 7.
--
-- Each such store gets one zone seeded from the union of the PLATFORM zones'
-- postcodes, which is the area the platform already serves and therefore the
-- area these stores have in practice been operating in. Fee and minimum use
-- the column defaults, matching Cesto's own terms.
--
-- Partners can narrow or replace this from their dashboard afterwards; it is
-- a starting point, not a commitment we are inventing on their behalf.
--
-- Idempotent: the NOT EXISTS guard means re-running adds nothing. Safe on a
-- fresh database, where it matches no rows.

INSERT INTO "delivery_zones" (id, name, postcodes, store_id, is_active, created_at, updated_at)
SELECT
    gen_random_uuid(),
    'Default delivery area',
    COALESCE(
      (SELECT ARRAY(
         SELECT DISTINCT unnest(z.postcodes)
         FROM "delivery_zones" z
         WHERE z.store_id IS NULL AND z.is_active = true
       )),
      ARRAY[]::text[]
    ),
    s.id,
    true,
    NOW(),
    NOW()
FROM "stores" s
WHERE s.status = 'live'
  AND s.deleted_at IS NULL
  AND s.deletion_scheduled_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "delivery_zones" dz
    WHERE dz.store_id = s.id AND dz.is_active = true
  );
