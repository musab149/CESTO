-- Which kind of customer a product is shown to (2026-10-25): both (the
-- default, so every existing product stays as it is), B2C only, or B2B only.
-- Additive: a new enum type and a NOT NULL column with a constant default,
-- which Postgres adds without rewriting the table.

-- CreateEnum
CREATE TYPE "ProductAudience" AS ENUM ('all', 'b2c', 'b2b');

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "audience" "ProductAudience" NOT NULL DEFAULT 'all';
