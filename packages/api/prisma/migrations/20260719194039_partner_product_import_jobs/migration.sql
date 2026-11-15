-- AlterTable
ALTER TABLE "auth_handoff_tokens" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "b2b_leads" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "stores" ALTER COLUMN "id" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "brands_source_is_active_idx" ON "brands"("source", "is_active");

-- CreateIndex
CREATE INDEX "origins_source_is_active_idx" ON "origins"("source", "is_active");
