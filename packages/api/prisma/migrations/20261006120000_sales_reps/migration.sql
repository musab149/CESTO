-- Sales reps.
--
-- A rep is a USER with a role row, not an Admin. Same shape as
-- PartnerStoreRole, and for the same reasons: anyone with an account can be
-- granted the role, the rep app authenticates with the ordinary user JWT and
-- calls /api/sales/*, and somebody who is a rep AND a customer AND a shop
-- owner is one login with three roles rather than three identities.
--
-- Entirely additive. Every column is nullable, nothing is backfilled, and no
-- existing row changes: an order built before this migration has both
-- creator columns as they were, and reads exactly as it did.
CREATE TABLE "sales_reps" (
  "user_id"             UUID         NOT NULL,
  "code"                TEXT,
  "is_active"           BOOLEAN      NOT NULL DEFAULT true,
  "granted_by_admin_id" UUID,
  "granted_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notes"               TEXT,
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMP(3) NOT NULL,

  CONSTRAINT "sales_reps_pkey" PRIMARY KEY ("user_id")
);

-- A staff number identifies one person or it identifies nobody.
CREATE UNIQUE INDEX "sales_reps_code_key" ON "sales_reps"("code");
CREATE INDEX "sales_reps_is_active_idx" ON "sales_reps"("is_active");

-- CASCADE: the role cannot outlive the account it belongs to.
ALTER TABLE "sales_reps"
  ADD CONSTRAINT "sales_reps_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- SET NULL: who granted it is history, and losing that admin must not take
-- the rep's role with it.
ALTER TABLE "sales_reps"
  ADD CONSTRAINT "sales_reps_granted_by_admin_id_fkey"
  FOREIGN KEY ("granted_by_admin_id") REFERENCES "admins"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Who built it, when a rep did ──────────────────────────────────────────
--
-- `created_by_admin_id` records staff. A rep is a User, so their work needs
-- its own column; "built for a customer rather than by one" becomes either
-- column being set. Both are nullable and at most one is ever filled.
ALTER TABLE "orders" ADD COLUMN "created_by_sales_rep_id" UUID;
ALTER TABLE "users"  ADD COLUMN "created_by_sales_rep_id" UUID;

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_created_by_sales_rep_id_fkey"
  FOREIGN KEY ("created_by_sales_rep_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "users"
  ADD CONSTRAINT "users_created_by_sales_rep_id_fkey"
  FOREIGN KEY ("created_by_sales_rep_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- The order books and the rep's own profile both filter on these.
CREATE INDEX "orders_created_by_sales_rep_id_idx" ON "orders"("created_by_sales_rep_id");
CREATE INDEX "users_created_by_sales_rep_id_idx"  ON "users"("created_by_sales_rep_id");
