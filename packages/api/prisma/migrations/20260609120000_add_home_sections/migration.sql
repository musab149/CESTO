-- CreateTable
CREATE TABLE "home_sections" (
    "key" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "home_sections_pkey" PRIMARY KEY ("key")
);
