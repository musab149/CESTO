-- CreateTable
CREATE TABLE "pending_products" (
    "id" UUID NOT NULL,
    "category_name_key" TEXT NOT NULL,
    "category_name_raw" TEXT NOT NULL,
    "subcategory_name_raw" TEXT,
    "product_key" TEXT NOT NULL,
    "name_es" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "description_es" TEXT,
    "description_en" TEXT,
    "brand" TEXT,
    "origin" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_featured" BOOLEAN NOT NULL DEFAULT false,
    "variants" JSONB NOT NULL,
    "image_urls" JSONB NOT NULL DEFAULT '[]',
    "source_row_number" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pending_products_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pending_products_category_name_key_idx" ON "pending_products"("category_name_key");
