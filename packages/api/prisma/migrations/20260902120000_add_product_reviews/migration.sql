-- ─── Product Reviews ────────────────────────────────────────
-- Real, verified-purchase reviews. Until now both the web and mobile apps
-- rendered five invented reviewers from a local Zustand store on EVERY
-- product, and there was no table behind them at all.
--
-- products.rating / products.rating_count already existed and were
-- admin-editable free text boxes. They become the denormalised aggregate over
-- the visible rows here, recomputed by the API inside the same transaction as
-- every insert/update/delete. Nothing is backfilled: every existing product
-- keeps whatever rating an admin typed until its first real review lands, at
-- which point the computed value replaces it. That is deliberate — silently
-- zeroing curated numbers on deploy would blank the storefront.
--
-- Additive: one new table, no column changes, no data migration.

-- CreateTable
CREATE TABLE "product_reviews" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "rating" INTEGER NOT NULL,
    "title" VARCHAR(120),
    "body" VARCHAR(4000) NOT NULL,
    "order_id" UUID,
    "is_hidden" BOOLEAN NOT NULL DEFAULT false,
    "hidden_reason" VARCHAR(300),
    "hidden_at" TIMESTAMP(3),
    "hidden_by_admin_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_reviews_pkey" PRIMARY KEY ("id")
);

-- One review per customer per product; a second submission edits the first.
-- CreateIndex
CREATE UNIQUE INDEX "product_reviews_product_id_user_id_key" ON "product_reviews"("product_id", "user_id");

-- The public list query: visible rows for one product, newest first.
-- CreateIndex
CREATE INDEX "product_reviews_product_id_is_hidden_created_at_idx" ON "product_reviews"("product_id", "is_hidden", "created_at");

-- CreateIndex
CREATE INDEX "product_reviews_user_id_idx" ON "product_reviews"("user_id");

-- Admin moderation queue filters on this.
-- CreateIndex
CREATE INDEX "product_reviews_is_hidden_idx" ON "product_reviews"("is_hidden");

-- Stars are 1-5. Enforced at the database as well as in the API's zod schema,
-- so a future caller that skips validation cannot corrupt the aggregate.
ALTER TABLE "product_reviews"
    ADD CONSTRAINT "product_reviews_rating_range" CHECK ("rating" BETWEEN 1 AND 5);

-- AddForeignKey
ALTER TABLE "product_reviews" ADD CONSTRAINT "product_reviews_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_reviews" ADD CONSTRAINT "product_reviews_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
