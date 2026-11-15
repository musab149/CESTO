-- CreateTable
CREATE TABLE "pending_categories" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "source_row_count" INTEGER NOT NULL DEFAULT 1,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pending_categories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pending_categories_name_key" ON "pending_categories"("name");
