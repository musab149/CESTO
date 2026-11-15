-- Unified partner identity rework (post-Slice-2 feedback).
-- Additive only — the legacy partner_users / partner_refresh_tokens tables
-- from the previous Slice 0 migration stay in place as a safety net and
-- will be dropped in a follow-up migration once the rework is verified.

-- ─── User: forced-password-change flag ─────────────────────────────
ALTER TABLE "users"
  ADD COLUMN "password_is_temp" BOOLEAN NOT NULL DEFAULT false;

-- ─── PartnerRole enum ──────────────────────────────────────────────
CREATE TYPE "PartnerRole" AS ENUM ('owner', 'manager');

-- ─── partner_store_roles ───────────────────────────────────────────
CREATE TABLE "partner_store_roles" (
  "user_id"            UUID NOT NULL,
  "store_id"           UUID NOT NULL,
  "role"               "PartnerRole" NOT NULL DEFAULT 'owner',
  "is_active"          BOOLEAN NOT NULL DEFAULT true,
  "invited_by_user_id" UUID,
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "partner_store_roles_pkey" PRIMARY KEY ("user_id", "store_id")
);

ALTER TABLE "partner_store_roles"
  ADD CONSTRAINT "partner_store_roles_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "partner_store_roles"
  ADD CONSTRAINT "partner_store_roles_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "partner_store_roles_store_id_role_idx" ON "partner_store_roles"("store_id", "role");
CREATE INDEX "partner_store_roles_is_active_idx"    ON "partner_store_roles"("is_active");

-- ─── auth_handoff_tokens ────────────────────────────────────────────
CREATE TABLE "auth_handoff_tokens" (
  "id"         UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id"    UUID NOT NULL,
  "token_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "used_at"    TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "auth_handoff_tokens_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "auth_handoff_tokens"
  ADD CONSTRAINT "auth_handoff_tokens_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "auth_handoff_tokens_token_hash_key" ON "auth_handoff_tokens"("token_hash");
CREATE INDEX "auth_handoff_tokens_user_id_idx"           ON "auth_handoff_tokens"("user_id");
CREATE INDEX "auth_handoff_tokens_expires_at_idx"        ON "auth_handoff_tokens"("expires_at");
