-- ─── Help Center: categories + articles ─────────────────

CREATE TABLE "help_categories" (
    "id"         UUID         NOT NULL,
    "slug"       TEXT         NOT NULL,
    "title_en"   TEXT         NOT NULL,
    "title_es"   TEXT         NOT NULL,
    "icon"       TEXT,
    "sort_order" INTEGER      NOT NULL DEFAULT 0,
    "is_active"  BOOLEAN      NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "help_categories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "help_categories_slug_key" ON "help_categories"("slug");
CREATE INDEX "help_categories_is_active_idx" ON "help_categories"("is_active");

CREATE TABLE "help_articles" (
    "id"          UUID         NOT NULL,
    "category_id" UUID         NOT NULL,
    "slug"        TEXT         NOT NULL,
    "title_en"    TEXT         NOT NULL,
    "title_es"    TEXT         NOT NULL,
    "body_en"     TEXT         NOT NULL DEFAULT '',
    "body_es"     TEXT         NOT NULL DEFAULT '',
    "sort_order"  INTEGER      NOT NULL DEFAULT 0,
    "is_active"   BOOLEAN      NOT NULL DEFAULT true,
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMP(3) NOT NULL,

    CONSTRAINT "help_articles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "help_articles_slug_key" ON "help_articles"("slug");
CREATE INDEX "help_articles_category_id_idx" ON "help_articles"("category_id");
CREATE INDEX "help_articles_is_active_idx" ON "help_articles"("is_active");

ALTER TABLE "help_articles"
  ADD CONSTRAINT "help_articles_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "help_categories"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
