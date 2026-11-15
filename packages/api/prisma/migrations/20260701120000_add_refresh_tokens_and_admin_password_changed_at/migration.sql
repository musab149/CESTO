-- Wave 2 security hardening: DB-backed refresh token rotation + admin
-- password-changed timestamp. Additive migration — no data loss.

-- Admins: add password_changed_at (null = never rotated since seed).
ALTER TABLE "admins" ADD COLUMN "password_changed_at" TIMESTAMP(3);

-- User refresh tokens: opaque token, SHA-256 hashed at rest.
CREATE TABLE "user_refresh_tokens" (
    "id"         UUID          NOT NULL,
    "user_id"    UUID          NOT NULL,
    "token_hash" TEXT          NOT NULL,
    "expires_at" TIMESTAMP(3)  NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_refresh_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_refresh_tokens_token_hash_key" ON "user_refresh_tokens"("token_hash");
CREATE INDEX "user_refresh_tokens_user_id_idx"    ON "user_refresh_tokens"("user_id");
CREATE INDEX "user_refresh_tokens_expires_at_idx" ON "user_refresh_tokens"("expires_at");

ALTER TABLE "user_refresh_tokens"
    ADD CONSTRAINT "user_refresh_tokens_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Admin refresh tokens.
CREATE TABLE "admin_refresh_tokens" (
    "id"         UUID          NOT NULL,
    "admin_id"   UUID          NOT NULL,
    "token_hash" TEXT          NOT NULL,
    "expires_at" TIMESTAMP(3)  NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "admin_refresh_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "admin_refresh_tokens_token_hash_key" ON "admin_refresh_tokens"("token_hash");
CREATE INDEX "admin_refresh_tokens_admin_id_idx"    ON "admin_refresh_tokens"("admin_id");
CREATE INDEX "admin_refresh_tokens_expires_at_idx"  ON "admin_refresh_tokens"("expires_at");

ALTER TABLE "admin_refresh_tokens"
    ADD CONSTRAINT "admin_refresh_tokens_admin_id_fkey"
    FOREIGN KEY ("admin_id") REFERENCES "admins"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
