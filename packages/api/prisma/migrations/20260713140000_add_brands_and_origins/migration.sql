-- ─── Brands + Origins → first-class tables ─────────────
-- Promotes what used to live in home_sections JSON blobs (`top-brands`,
-- `shop-by-origin`) to real tables. Products gain nullable FK columns to
-- point at them; the existing `brand` / `origin` string columns are kept as
-- denormalised fallbacks so older API deploys don't 500 during the rollout
-- window (see [[deploy-shape-skew]]).
--
-- Additive migration only. Data backfill (seed rows from the legacy JSON
-- blobs + resolve product strings to FKs) is intentionally NOT in this
-- migration — it ships as `packages/api/prisma/backfill-brands-origins.mjs`
-- for the admin to run once per environment, on their schedule, after code
-- deploys. Rationale: keeps the schema change safe to run twice on the same
-- DB and lets the backfill be re-runnable/idempotent independently.

CREATE TABLE "brands" (
    "id"         UUID         NOT NULL,
    "name"       TEXT         NOT NULL,
    "slug"       TEXT         NOT NULL,
    "logo_url"   TEXT,
    "logo_bg"   TEXT,
    "link"       TEXT,
    "is_active"  BOOLEAN      NOT NULL DEFAULT true,
    "sort_order" INTEGER      NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "brands_name_key" ON "brands" ("name");
CREATE UNIQUE INDEX "brands_slug_key" ON "brands" ("slug");
CREATE INDEX "brands_is_active_sort_order_idx" ON "brands" ("is_active", "sort_order");

CREATE TABLE "origins" (
    "id"           UUID         NOT NULL,
    "key"          TEXT         NOT NULL,
    "label_es"     TEXT         NOT NULL,
    "label_en"     TEXT         NOT NULL,
    "bg_color"     TEXT,
    "accent_color" TEXT,
    "image_url"    TEXT,
    "link"         TEXT,
    "is_active"    BOOLEAN      NOT NULL DEFAULT true,
    "sort_order"   INTEGER      NOT NULL DEFAULT 0,
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "origins_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "origins_key_key" ON "origins" ("key");
CREATE INDEX "origins_is_active_sort_order_idx" ON "origins" ("is_active", "sort_order");

ALTER TABLE "products" ADD COLUMN "brand_id"  UUID;
ALTER TABLE "products" ADD COLUMN "origin_id" UUID;

CREATE INDEX "products_brand_id_idx"  ON "products" ("brand_id");
CREATE INDEX "products_origin_id_idx" ON "products" ("origin_id");

ALTER TABLE "products"
    ADD CONSTRAINT "products_brand_id_fkey"
    FOREIGN KEY ("brand_id") REFERENCES "brands" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "products"
    ADD CONSTRAINT "products_origin_id_fkey"
    FOREIGN KEY ("origin_id") REFERENCES "origins" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
