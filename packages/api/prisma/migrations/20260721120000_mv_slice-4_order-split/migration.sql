-- ─── MV Slice 4 — Order model split ────────────────────────
-- Adds the parent_orders table and two new FKs on orders (parent_order_id,
-- store_id) so checkout can split a cross-store cart into one ParentOrder +
-- N sub-Orders. Adds the `partially_completed` OrderStatus enum value used
-- by deriveParentOrderStatus() when subs reach mixed terminal states.
--
-- Additive-only per ground rule #1. All new columns are NULLABLE — existing
-- rows keep pre-mv semantics (parent_order_id=NULL, store_id=NULL), and
-- checkout only populates them when MV_ORDER_SPLIT=true. Slice 7 (contract)
-- backfills NULL store_ids to the Cesto store row and tightens to NOT NULL.
--
-- See docs/MULTIVENDOR_ROADMAP.md → Slice 4 for the full plan.

-- ─── Enum addition ─────────────────────────────────────────
-- New value only ever set on ParentOrder-derived status (never on a sub).
-- Postgres allows ADD VALUE without wrapping in a transaction on 12+.

ALTER TYPE "OrderStatus" ADD VALUE 'partially_completed';

-- ─── parent_orders ─────────────────────────────────────────
-- No status column — parent status is a pure function of its subs
-- (see packages/api/src/lib/parentOrder.ts). Address + payment method live
-- here so refund/receipt UIs can render the whole-order shape from a
-- single row without joining every sub.

CREATE TABLE "parent_orders" (
    "id"                 UUID            NOT NULL,
    "order_number"       TEXT            NOT NULL,
    "user_id"            UUID            NOT NULL,
    "address_id"         UUID            NOT NULL,
    "address_snapshot"   JSONB           NOT NULL,
    "payment_method"     "PaymentMethod" NOT NULL DEFAULT 'cod',
    "subtotal"           DECIMAL(10, 2)  NOT NULL,
    "delivery_fee_total" DECIMAL(10, 2)  NOT NULL,
    "total"              DECIMAL(10, 2)  NOT NULL,
    "customer_notes"     TEXT,
    "created_at"         TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"         TIMESTAMP(3)    NOT NULL,

    CONSTRAINT "parent_orders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "parent_orders_order_number_key" ON "parent_orders"("order_number");
CREATE INDEX        "parent_orders_user_id_idx"      ON "parent_orders"("user_id");
CREATE INDEX        "parent_orders_created_at_idx"   ON "parent_orders"("created_at");
CREATE INDEX        "parent_orders_order_number_idx" ON "parent_orders"("order_number");

ALTER TABLE "parent_orders" ADD CONSTRAINT "parent_orders_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "parent_orders" ADD CONSTRAINT "parent_orders_address_id_fkey"
  FOREIGN KEY ("address_id") REFERENCES "addresses"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── orders additions ──────────────────────────────────────
-- parent_order_id: null = single-store checkout (no ParentOrder needed).
-- Cascade on parent delete because a sub-order without its parent context
-- is meaningless (parent deletion only happens in rare admin cleanup).
--
-- store_id: null = Cesto house store (matches Product.store_id convention).
-- Restrict on store delete because losing an order's store attribution
-- silently would corrupt partner revenue/history — deletes go through the
-- soft-delete pattern which never actually removes rows.

ALTER TABLE "orders"
  ADD COLUMN "parent_order_id" UUID,
  ADD COLUMN "store_id"        UUID;

CREATE INDEX "orders_parent_order_id_idx" ON "orders"("parent_order_id");
CREATE INDEX "orders_store_id_status_idx" ON "orders"("store_id", "status");

ALTER TABLE "orders" ADD CONSTRAINT "orders_parent_order_id_fkey"
  FOREIGN KEY ("parent_order_id") REFERENCES "parent_orders"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "orders" ADD CONSTRAINT "orders_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
