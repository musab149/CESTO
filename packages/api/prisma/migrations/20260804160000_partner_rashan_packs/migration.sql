-- Partner-owned rashan packs.
--
-- Additive. Existing packs and subscriptions keep store_id NULL, which means
-- "Cesto" — exactly the behaviour they have today.

-- ─── RashanPack: owning store + admin kill switch ───────────────────────
ALTER TABLE "rashan_packs" ADD COLUMN "store_id" UUID;
ALTER TABLE "rashan_packs" ADD COLUMN "admin_blocked_at" TIMESTAMP(3);
ALTER TABLE "rashan_packs" ADD COLUMN "admin_block_reason" TEXT;

CREATE INDEX "rashan_packs_store_id_is_active_idx" ON "rashan_packs"("store_id", "is_active");

-- Cascade: a hard-deleted store takes its pack templates with it. Safe
-- because subscriptions snapshot their items and pack_slug, and their own FK
-- to the pack is ON DELETE SET NULL (Prisma's default for an optional
-- relation), so live subscriptions survive.
ALTER TABLE "rashan_packs"
  ADD CONSTRAINT "rashan_packs_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── RashanSubscription: which store fulfils it ─────────────────────────
ALTER TABLE "rashan_subscriptions" ADD COLUMN "store_id" UUID;

CREATE INDEX "rashan_subscriptions_store_id_status_idx" ON "rashan_subscriptions"("store_id", "status");

-- SetNull, not Cascade: the customer's subscription and its delivery history
-- must outlive the store row.
ALTER TABLE "rashan_subscriptions"
  ADD CONSTRAINT "rashan_subscriptions_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: point existing subscriptions at their pack's store. Every pack is
-- currently a Cesto pack, so this is a no-op today — it exists so the column
-- is correct if this migration is ever replayed against a database where
-- partner packs already exist.
UPDATE "rashan_subscriptions" s
SET "store_id" = p."store_id"
FROM "rashan_packs" p
WHERE s."pack_id" = p."id" AND p."store_id" IS NOT NULL;

-- ─── One active subscription per customer per store ─────────────────────
--
-- COALESCE, not a bare (user_id, store_id): in Postgres NULLs are distinct in
-- a unique index, so a plain index would happily allow a customer six
-- concurrent Cesto subscriptions while correctly capping partner ones at one.
-- The sentinel UUID collapses every Cesto row into a single comparable value.
--
-- Partial on status: cancelled subscriptions must not block the customer from
-- ever subscribing to that store again.
--
-- NOTE: Prisma cannot model a partial or expression index, so this does not
-- appear in schema.prisma and `prisma migrate diff` will report it as drift.
-- That is expected. Do not drop it to silence the diff — it is the only thing
-- preventing a double-submitted checkout from creating two live subscriptions.
CREATE UNIQUE INDEX "rashan_subscriptions_user_store_active_key"
  ON "rashan_subscriptions" (
    "user_id",
    COALESCE("store_id", '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE "status" <> 'cancelled';
