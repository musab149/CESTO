-- Store provenance + partner application profiles.
--
-- WHY created_via EXISTS
--
-- Admin can link a partner application to an EXISTING store rather than
-- creating one. Only stores Cesto set up itself are eligible: a store created
-- BY an approval already belongs to a partner, and offering it in the link
-- picker would mean handing one partner's storefront to another.
--
-- This is not derivable after the fact. "Has no PartnerStoreRole" is true both
-- for an admin-created store and for an approval-created store whose partner
-- was later removed, and those two must not be treated the same.
--
-- Default is 'admin' because that is what a row created through the admin
-- panel is. The backfill below then corrects the approval-created ones.
--
-- WHY partner_profiles EXISTS
--
-- Approving a partner_store lead discarded everything the applicant typed —
-- company, trading location, registration number — because only the Store row
-- was carried forward. Support had no record of who was onboarded beyond a
-- store name, and the partner could not see their own submission.
--
-- Deliberately NOT business_profiles despite identical columns: that table
-- marks a wholesale BUYER and /api/users/me returns it as `business_profile`,
-- which the storefront renders as a B2B account panel. A partner is a seller.
--
-- ADDITIVE except for the backfill UPDATE, which only rewrites the new column.

-- CreateEnum
CREATE TYPE "StoreOrigin" AS ENUM ('admin', 'partner_approval');

-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "created_via" "StoreOrigin" NOT NULL DEFAULT 'admin';

-- CreateTable
CREATE TABLE "partner_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "company" TEXT NOT NULL,
    "business_type" TEXT,
    "location" TEXT,
    "website" TEXT,
    "registration_no" TEXT,
    "contact_phone" TEXT,
    "source_lead_id" UUID,
    "linked_store_id" UUID,
    "linked_existing" BOOLEAN NOT NULL DEFAULT false,
    "approved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_by_admin_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partner_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "partner_profiles_user_id_key" ON "partner_profiles"("user_id");

-- CreateIndex
CREATE INDEX "partner_profiles_company_idx" ON "partner_profiles"("company");

-- CreateIndex
CREATE INDEX "partner_profiles_linked_store_id_idx" ON "partner_profiles"("linked_store_id");

-- AddForeignKey
ALTER TABLE "partner_profiles" ADD CONSTRAINT "partner_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_profiles" ADD CONSTRAINT "partner_profiles_source_lead_id_fkey" FOREIGN KEY ("source_lead_id") REFERENCES "b2b_leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_profiles" ADD CONSTRAINT "partner_profiles_linked_store_id_fkey" FOREIGN KEY ("linked_store_id") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ─── Backfill provenance ───────────────────────────────────
-- A store referenced by an approved lead was created by that approval. Every
-- other store predates the approval path or was created in the admin panel,
-- and keeps the 'admin' default.
--
-- Idempotent: re-running sets the same rows to the same value.
UPDATE "stores" s
SET created_via = 'partner_approval'
FROM "b2b_leads" l
WHERE l.approved_store_id = s.id
  AND s.created_via = 'admin';

-- Belt and braces: a store that already has a partner attached is not
-- unclaimed inventory, whatever created it. Without this, a store an admin
-- created and then manually attached a partner to would still be offered in
-- the link picker.
UPDATE "stores" s
SET created_via = 'partner_approval'
WHERE s.created_via = 'admin'
  AND EXISTS (SELECT 1 FROM "partner_store_roles" r WHERE r.store_id = s.id);
