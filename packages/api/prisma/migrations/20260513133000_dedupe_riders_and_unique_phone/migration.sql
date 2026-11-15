-- Consolidate duplicate riders (same phone), then enforce uniqueness on phone.
-- Earlier seed runs used createMany without upsert, leaving multiple rows
-- per rider. We keep the oldest row per phone as canonical.

-- 1. Re-point any orders referencing a non-canonical rider at the canonical one.
WITH canonical AS (
  SELECT DISTINCT ON (phone) id, phone
  FROM "riders"
  ORDER BY phone, created_at ASC
)
UPDATE "orders" o
SET rider_id = c.id
FROM "riders" r
JOIN canonical c ON c.phone = r.phone AND c.id <> r.id
WHERE o.rider_id = r.id;

-- 2. Delete the non-canonical duplicates.
DELETE FROM "riders" r
USING (
  SELECT DISTINCT ON (phone) id, phone
  FROM "riders"
  ORDER BY phone, created_at ASC
) c
WHERE c.phone = r.phone AND c.id <> r.id;

-- 3. Enforce uniqueness going forward.
CREATE UNIQUE INDEX "riders_phone_key" ON "riders"("phone");
