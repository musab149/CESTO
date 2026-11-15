-- Home Grocery requests (formerly "rashan leads")
--
-- The /rashan form stops being a triage inbox and becomes an application,
-- the way /b2b-deals is: an admin approves a request (the household becomes a
-- Home Grocery subscriber) or rejects it with a reason the customer is told.
--
-- ADDITIVE. No column is dropped or rewritten; every existing request keeps
-- every field it had. The only data change is the backfill in section 5,
-- which fills the new columns and inserts profile rows — nothing it touches
-- existed before this migration.

-- ── 1 · Approval state ───────────────────────────────────────────────────
CREATE TYPE "RashanLeadApprovalStatus" AS ENUM ('pending_review', 'approved', 'rejected');

ALTER TABLE "rashan_leads"
  ADD COLUMN "approval_status"      "RashanLeadApprovalStatus" NOT NULL DEFAULT 'pending_review',
  ADD COLUMN "approved_at"          TIMESTAMP(3),
  ADD COLUMN "approved_user_id"     UUID,
  ADD COLUMN "approved_by_admin_id" UUID,
  ADD COLUMN "rejected_at"          TIMESTAMP(3),
  ADD COLUMN "rejection_reason"     TEXT;

CREATE INDEX "rashan_leads_approval_status_created_at_idx"
  ON "rashan_leads"("approval_status", "created_at");

ALTER TABLE "rashan_leads"
  ADD CONSTRAINT "rashan_leads_approved_user_id_fkey"
  FOREIGN KEY ("approved_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ── 2 · HomeGroceryProfile ───────────────────────────────────────────────
CREATE TABLE "home_grocery_profiles" (
    "id"                   UUID                  NOT NULL,
    "user_id"              UUID                  NOT NULL,
    "household_size"       INTEGER               NOT NULL,
    "adults"               INTEGER,
    "children"             INTEGER,
    "frequency"            "RashanLeadFrequency" NOT NULL DEFAULT 'monthly',
    "preferred_slot"       TEXT,
    "dietary_notes"        TEXT,
    "budget_per_cycle"     DECIMAL(10,2),
    "contact_phone"        TEXT,
    "source_lead_id"       UUID,
    "approved_at"          TIMESTAMP(3)          NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_by_admin_id" UUID,
    "created_at"           TIMESTAMP(3)          NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"           TIMESTAMP(3)          NOT NULL,

    CONSTRAINT "home_grocery_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "home_grocery_profiles_user_id_key" ON "home_grocery_profiles"("user_id");

ALTER TABLE "home_grocery_profiles"
  ADD CONSTRAINT "home_grocery_profiles_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "home_grocery_profiles"
  ADD CONSTRAINT "home_grocery_profiles_source_lead_id_fkey"
  FOREIGN KEY ("source_lead_id") REFERENCES "rashan_leads"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ── 3 · Notification types ───────────────────────────────────────────────
-- IF NOT EXISTS so a replay against a database that already has them does
-- not fail on a duplicate label — the failure mode that P3009-blocked
-- production on 2026-08-31. None of these values is used below, which is
-- what lets them share a migration with the backfill.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'home_grocery_approved';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'home_grocery_rejected';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'admin_home_grocery_request';

-- ── 4 · (no remap) ───────────────────────────────────────────────────────
-- `status` is deliberately left alone. It stays the ops funnel; the new
-- approval_status is the decision. A request still `new`/`contacted`/
-- `qualified` is simply pending, which is the column default.

-- ── 5 · Backfill: requests ops already marked `converted` ────────────────
-- Before this, `converted` was a status an admin set by hand once the
-- household was looked after. Production holds six; none ever linked a
-- subscription. Where the household HAS an account, that is an approval in
-- all but name, so it is recorded as one and the household gets a profile —
-- otherwise every customer ops already took on would vanish from the new
-- Home Grocery tab on deploy.
--
-- Where there is NO account, the request stays pending_review. It cannot be
-- approved without a user to attach it to, and leaving it open puts it back
-- in front of an admin, whose approval will create the account properly.
--
-- Account resolution, most specific first: the user who was logged in when
-- they submitted; else an exact email match; else a case-insensitive one
-- (accounts predating email lowercasing exist — see email case normalisation).
UPDATE "rashan_leads" l
SET "approval_status"  = 'approved',
    "approved_user_id" = m.user_id,
    "approved_at"      = COALESCE(l."converted_at", l."updated_at")
FROM (
  SELECT l2."id" AS lead_id,
         COALESCE(
           (SELECT u."id" FROM "users" u WHERE u."id" = l2."user_id"),
           (SELECT u."id" FROM "users" u WHERE u."email" = l2."email" LIMIT 1),
           (SELECT u."id" FROM "users" u
             WHERE lower(u."email") = lower(l2."email")
             ORDER BY u."created_at" ASC LIMIT 1)
         ) AS user_id
  FROM "rashan_leads" l2
  WHERE l2."status" = 'converted'
) m
WHERE l."id" = m.lead_id
  AND m.user_id IS NOT NULL;

-- One profile per account, from that account's most recent approved request.
-- ON CONFLICT: nothing can be there yet, but a replay must not fail.
INSERT INTO "home_grocery_profiles" (
  "id", "user_id", "household_size", "adults", "children", "frequency",
  "preferred_slot", "dietary_notes", "budget_per_cycle", "contact_phone",
  "source_lead_id", "approved_at", "created_at", "updated_at"
)
SELECT DISTINCT ON (l."approved_user_id")
  gen_random_uuid(), l."approved_user_id", l."household_size", l."adults", l."children", l."frequency",
  l."preferred_slot", l."dietary_notes", l."budget_per_cycle", l."phone",
  l."id", l."approved_at", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "rashan_leads" l
WHERE l."approval_status" = 'approved'
  AND l."approved_user_id" IS NOT NULL
ORDER BY l."approved_user_id", l."created_at" DESC
ON CONFLICT ("user_id") DO NOTHING;
