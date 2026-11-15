-- One checkout attempt, remembered by the key the client sent with it.
--
-- Entirely additive: one new table, no column added to any existing one, no
-- backfill, nothing destructive. Orders placed before this simply have no row
-- here, and a checkout that sends no Idempotency-Key header behaves exactly as
-- it does today — which is what keeps an older web or mobile bundle working
-- while the API deploys ahead of it.
--
-- The composite primary key is the load-bearing part. It is what makes two
-- simultaneous requests carrying the same key unable to both commit, since the
-- row is written inside the checkout transaction.

CREATE TABLE "order_idempotency" (
    "user_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "order_id" UUID,
    "parent_order_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_idempotency_pkey" PRIMARY KEY ("user_id","key")
);

CREATE INDEX "order_idempotency_order_id_idx" ON "order_idempotency"("order_id");
CREATE INDEX "order_idempotency_parent_order_id_idx" ON "order_idempotency"("parent_order_id");
