-- ─── Product Types — third-tier taxonomy ─────────────────
-- Adds a level between SubCategory and Product. Optional on Product:
-- legacy rows keep product_type_id = NULL and remain tied to their
-- subcategory. On delete of a product type, ON DELETE SET NULL leaves
-- products cleanly parked under their subcategory (no orphaning, no
-- product loss). See docs and schema.prisma for the full design.
--
-- Purely additive: new table + one nullable column on products.
-- Backwards-compatible with every existing frontend deploy.

CREATE TABLE "product_types" (
    "id"             UUID         NOT NULL,
    "subcategory_id" UUID         NOT NULL,
    "name_es"        TEXT         NOT NULL,
    "name_en"        TEXT         NOT NULL,
    "sort_order"     INTEGER      NOT NULL DEFAULT 0,
    "is_active"      BOOLEAN      NOT NULL DEFAULT true,
    "source"         TEXT         NOT NULL DEFAULT 'manual',
    "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_types_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "product_types_subcategory_id_idx"    ON "product_types"("subcategory_id");
CREATE INDEX "product_types_is_active_idx"         ON "product_types"("is_active");
CREATE INDEX "product_types_source_is_active_idx"  ON "product_types"("source", "is_active");

-- Cascade delete: a product type is meaningless without its parent
-- subcategory, so removing the subcategory takes its types with it.
ALTER TABLE "product_types"
  ADD CONSTRAINT "product_types_subcategory_id_fkey"
  FOREIGN KEY ("subcategory_id") REFERENCES "subcategories"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Nullable FK on products — optional third tier. SetNull on delete so a
-- removed product type leaves its products parked under just their
-- subcategory (per user's design decision, 2026-07-17).
ALTER TABLE "products" ADD COLUMN "product_type_id" UUID;

ALTER TABLE "products"
  ADD CONSTRAINT "products_product_type_id_fkey"
  FOREIGN KEY ("product_type_id") REFERENCES "product_types"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "products_product_type_id_idx" ON "products"("product_type_id");
