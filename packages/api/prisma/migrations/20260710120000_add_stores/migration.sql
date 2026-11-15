-- ─── Stores + Store Follows ─────────────────────────────
-- Promotes partner shops from a JSON blob (HomeSection key "top-shops")
-- to a first-class table. Product.shop_id (string slug) becomes
-- Product.store_id (uuid FK). Existing shop slugs are seeded as Store rows
-- so no product loses its shop association.

-- 1. Stores table
CREATE TABLE "stores" (
  "id"              UUID NOT NULL DEFAULT gen_random_uuid(),
  "slug"            TEXT NOT NULL,
  "name"            TEXT NOT NULL,
  "tagline_es"      TEXT,
  "tagline_en"      TEXT,
  "description_es"  TEXT,
  "description_en"  TEXT,
  "logo_url"        TEXT,
  "logo_bg"         VARCHAR(9) NOT NULL DEFAULT '#FFFFFF',
  "cover_url"       TEXT,
  "rating"          DOUBLE PRECISION,
  "rating_count"    INTEGER NOT NULL DEFAULT 0,
  "followers_count" INTEGER NOT NULL DEFAULT 0,
  "is_active"       BOOLEAN NOT NULL DEFAULT true,
  "is_verified"     BOOLEAN NOT NULL DEFAULT false,
  "fast_delivery"   BOOLEAN NOT NULL DEFAULT false,
  "origin"          TEXT,
  "contact_email"   TEXT,
  "contact_phone"   TEXT,
  "website_url"     TEXT,
  "shop_hours"      JSONB,
  "sort_order"      INTEGER NOT NULL DEFAULT 0,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3) NOT NULL,

  CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stores_slug_key" ON "stores"("slug");
CREATE INDEX "stores_is_active_idx" ON "stores"("is_active");
CREATE INDEX "stores_slug_idx" ON "stores"("slug");

-- 2. Store follows join table
CREATE TABLE "store_follows" (
  "user_id"    UUID NOT NULL,
  "store_id"   UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "store_follows_pkey" PRIMARY KEY ("user_id", "store_id")
);

CREATE INDEX "store_follows_store_id_idx" ON "store_follows"("store_id");

ALTER TABLE "store_follows"
  ADD CONSTRAINT "store_follows_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "store_follows"
  ADD CONSTRAINT "store_follows_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. Seed Stores from the current HomeSection "top-shops" JSON blob.
--    Uses the TopShop.id as the new Store.slug so existing Product.shop_id
--    string values still resolve. If the row doesn't exist yet (fresh DB),
--    this is a no-op.
INSERT INTO "stores" (
  "id", "slug", "name",
  "logo_url", "logo_bg", "cover_url",
  "rating", "rating_count", "fast_delivery",
  "sort_order", "is_active", "updated_at"
)
SELECT
  gen_random_uuid(),
  s->>'id',
  s->>'name',
  NULLIF(s->>'logo_url', ''),
  COALESCE(NULLIF(s->>'logo_bg', ''), '#FFFFFF'),
  NULLIF(s->>'cover_url', ''),
  NULLIF(s->>'rating', '')::double precision,
  COALESCE(NULLIF(s->>'rating_count', '')::integer, 0),
  COALESCE((s->>'fast_delivery')::boolean, false),
  COALESCE(NULLIF(s->>'display_order', '')::integer, 0),
  COALESCE((s->>'is_active')::boolean, true),
  CURRENT_TIMESTAMP
FROM "home_sections",
     jsonb_array_elements("config"->'shops') AS s
WHERE "home_sections"."key" = 'top-shops'
  AND s->>'id' IS NOT NULL
  AND s->>'id' <> ''
ON CONFLICT ("slug") DO NOTHING;

-- 4. Add products.store_id column
ALTER TABLE "products" ADD COLUMN "store_id" UUID;

-- 5. Backfill products.store_id from the old shop_id string via stores.slug
UPDATE "products" p
SET "store_id" = s."id"
FROM "stores" s
WHERE p."shop_id" IS NOT NULL
  AND p."shop_id" = s."slug";

-- 6. FK + index; drop old shop_id column + its index
ALTER TABLE "products"
  ADD CONSTRAINT "products_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "products_store_id_idx" ON "products"("store_id");

DROP INDEX IF EXISTS "products_shop_id_idx";
ALTER TABLE "products" DROP COLUMN "shop_id";

-- Same treatment for pending_products so bulk imports keep working. We keep
-- it as a plain string column there (no FK) — pending rows are staging,
-- and the shop reference is materialised into a real store_id only when
-- the row is published into products.
-- (No schema change required — pending_products.shop_id keeps its string
--  slug, and the publish path in admin/categories resolves the slug to a
--  store_id at publish time.)
