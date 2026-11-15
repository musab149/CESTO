-- ─── MV Slice 0 — Foundation ───────────────────────────────
-- First multi-vendor migration. Dark to customers: only new tables and
-- nullable/defaulted columns. Nothing reads any of it yet — Slices 1+
-- wire the endpoints and UI. Every existing row keeps working with
-- pre-mv semantics because defaults preserve current behaviour.
--
-- See docs/MULTIVENDOR_ROADMAP.md → Slice 0 for the full plan.
-- Additive-only per ground rule #1. All FKs on new columns are nullable
-- during coexistence per ground rule #3. Tighten in Slice 7 (contract).

-- ─── Enums ─────────────────────────────────────────────────

CREATE TYPE "StoreStatus"          AS ENUM ('draft', 'live', 'suspended');
CREATE TYPE "B2bLeadApprovalStatus" AS ENUM ('pending_review', 'approved', 'needs_info', 'rejected');

-- ─── New tables ────────────────────────────────────────────

-- partner_users: auth identity for approved partner store owners.
-- Store FK is NOT NULL (a PartnerUser without a Store is meaningless).
-- Cascade so hard-deleting a Store (rare, manual) also removes its users.
CREATE TABLE "partner_users" (
    "id"                  UUID           NOT NULL,
    "store_id"            UUID           NOT NULL,
    "name"                TEXT           NOT NULL,
    "email"               TEXT           NOT NULL,
    "phone"               TEXT,
    "password_hash"       TEXT           NOT NULL,
    "is_active"           BOOLEAN        NOT NULL DEFAULT true,
    "is_test"             BOOLEAN        NOT NULL DEFAULT false,
    "last_login_at"       TIMESTAMP(3),
    "password_changed_at" TIMESTAMP(3),
    "created_at"          TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"          TIMESTAMP(3)   NOT NULL,

    CONSTRAINT "partner_users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "partner_users_email_key"     ON "partner_users"("email");
CREATE INDEX        "partner_users_store_id_idx"  ON "partner_users"("store_id");
CREATE INDEX        "partner_users_is_active_idx" ON "partner_users"("is_active");
CREATE INDEX        "partner_users_is_test_idx"   ON "partner_users"("is_test");

ALTER TABLE "partner_users" ADD CONSTRAINT "partner_users_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- partner_refresh_tokens: opaque token store, mirrors admin_refresh_tokens.
CREATE TABLE "partner_refresh_tokens" (
    "id"              UUID         NOT NULL,
    "partner_user_id" UUID         NOT NULL,
    "token_hash"      TEXT         NOT NULL,
    "expires_at"      TIMESTAMP(3) NOT NULL,
    "revoked_at"      TIMESTAMP(3),
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_refresh_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "partner_refresh_tokens_token_hash_key"      ON "partner_refresh_tokens"("token_hash");
CREATE INDEX        "partner_refresh_tokens_partner_user_id_idx" ON "partner_refresh_tokens"("partner_user_id");
CREATE INDEX        "partner_refresh_tokens_expires_at_idx"      ON "partner_refresh_tokens"("expires_at");

ALTER TABLE "partner_refresh_tokens" ADD CONSTRAINT "partner_refresh_tokens_partner_user_id_fkey"
  FOREIGN KEY ("partner_user_id") REFERENCES "partner_users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── stores additions ──────────────────────────────────────
-- status defaults to 'live' so every existing row remains customer-visible
-- (no behaviour change). is_test defaults to false — legacy rows are real.

ALTER TABLE "stores"
  ADD COLUMN "status"  "StoreStatus" NOT NULL DEFAULT 'live',
  ADD COLUMN "is_test" BOOLEAN       NOT NULL DEFAULT false;

CREATE INDEX "stores_status_idx"  ON "stores"("status");
CREATE INDEX "stores_is_test_idx" ON "stores"("is_test");

-- ─── riders additions ──────────────────────────────────────
-- store_id nullable: legacy riders were platform-pool; keep them that way
-- during coexistence. Slice 7 backfills as needed. SetNull on store delete
-- so a rider survives store offboarding and can be reassigned.

ALTER TABLE "riders"
  ADD COLUMN "store_id"  UUID,
  ADD COLUMN "is_test"   BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN "fcm_token" VARCHAR(255);

ALTER TABLE "riders" ADD CONSTRAINT "riders_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "riders_store_id_idx" ON "riders"("store_id");
CREATE INDEX "riders_is_test_idx"  ON "riders"("is_test");

-- ─── delivery_zones additions ──────────────────────────────
-- store_id nullable = platform-wide zone (all stores may use it). Legacy
-- rows stay platform-wide. Cascade on store delete because a zone is
-- meaningless without its owning store.

ALTER TABLE "delivery_zones"
  ADD COLUMN "store_id" UUID;

ALTER TABLE "delivery_zones" ADD CONSTRAINT "delivery_zones_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "delivery_zones_store_id_idx" ON "delivery_zones"("store_id");

-- ─── b2b_leads additions ───────────────────────────────────
-- approval_status is a NEW column alongside the existing free-text `status`
-- (which stays for generic triage). approval_status is only meaningful
-- when type='partner'. Non-partner leads stay at pending_review forever
-- and are ignored by Slice 1's approval UI.

ALTER TABLE "b2b_leads"
  ADD COLUMN "approval_status"          "B2bLeadApprovalStatus" NOT NULL DEFAULT 'pending_review',
  ADD COLUMN "approved_at"              TIMESTAMP(3),
  ADD COLUMN "approved_store_id"        UUID,
  ADD COLUMN "approved_partner_user_id" UUID,
  ADD COLUMN "magic_link_token_hash"    TEXT,
  ADD COLUMN "magic_link_expires_at"    TIMESTAMP(3);

CREATE UNIQUE INDEX "b2b_leads_magic_link_token_hash_key" ON "b2b_leads"("magic_link_token_hash");
CREATE INDEX        "b2b_leads_approval_status_created_at_idx" ON "b2b_leads"("approval_status", "created_at");

ALTER TABLE "b2b_leads" ADD CONSTRAINT "b2b_leads_approved_store_id_fkey"
  FOREIGN KEY ("approved_store_id") REFERENCES "stores"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "b2b_leads" ADD CONSTRAINT "b2b_leads_approved_partner_user_id_fkey"
  FOREIGN KEY ("approved_partner_user_id") REFERENCES "partner_users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
