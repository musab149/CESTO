-- B2B business accounts
--
-- Splits the B2bLead funnel into two distinct approval paths:
--   business      → wholesale BUYER. Approval creates a User + BusinessProfile
--                   with b2b pricing. No store, no partner dashboard.
--   partner_store → SELLER. Approval creates a Store + PartnerStoreRole
--                   (the existing, unchanged mv Slice 1 flow).
--
-- Additive except for the `type` value remap, which is a pure data update on
-- a free-text String column (no enum, no constraint) and is reversible by
-- running the inverse UPDATEs.

-- ── 1 · Pricing mode enum ────────────────────────────────────────────────
CREATE TYPE "PricingMode" AS ENUM ('retail', 'b2b');

-- ── 2 · User: business flag + active price view ──────────────────────────
ALTER TABLE "users"
  ADD COLUMN "is_business"  BOOLEAN       NOT NULL DEFAULT false,
  ADD COLUMN "pricing_mode" "PricingMode" NOT NULL DEFAULT 'retail';

CREATE INDEX "users_is_business_idx" ON "users"("is_business");

-- ── 3 · B2bLead: link to the User created at approval ────────────────────
-- Replaces the legacy approved_partner_user_id FK (kept in place for now;
-- the old PartnerUser table is dropped in mv Slice 7).
ALTER TABLE "b2b_leads" ADD COLUMN "approved_user_id" UUID;

ALTER TABLE "b2b_leads"
  ADD CONSTRAINT "b2b_leads_approved_user_id_fkey"
  FOREIGN KEY ("approved_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ── 4 · BusinessProfile ──────────────────────────────────────────────────
CREATE TABLE "business_profiles" (
    "id"                   UUID         NOT NULL,
    "user_id"              UUID         NOT NULL,
    "company"              TEXT         NOT NULL,
    "business_type"        TEXT,
    "location"             TEXT,
    "website"              TEXT,
    "registration_no"      TEXT,
    "contact_phone"        TEXT,
    "source_lead_id"       UUID,
    "approved_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_by_admin_id" UUID,
    "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"           TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "business_profiles_user_id_key" ON "business_profiles"("user_id");
CREATE INDEX "business_profiles_company_idx" ON "business_profiles"("company");

ALTER TABLE "business_profiles"
  ADD CONSTRAINT "business_profiles_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "business_profiles"
  ADD CONSTRAINT "business_profiles_source_lead_id_fkey"
  FOREIGN KEY ("source_lead_id") REFERENCES "b2b_leads"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ── 5 · Remap the inverted lead type vocabulary ──────────────────────────
-- Historically /b2b-deals (the wholesale BUYER form) submitted type='partner'
-- and that value was what drove store creation, while /partner-deals (the
-- SELLER form) submitted type='supplier' and had no approval path at all.
-- Correct the vocabulary so the value names what the applicant actually is.
--
-- The two statements are independent — 'partner_store' is not an exact match
-- for the 'partner' predicate below, so neither can catch rows the other
-- wrote and the order is free.
UPDATE "b2b_leads" SET "type" = 'partner_store' WHERE "type" = 'supplier';
UPDATE "b2b_leads" SET "type" = 'business'      WHERE "type" = 'partner';

-- `source` is left untouched on purpose — it records which form furnished the
-- row and is used for funnel attribution, so rewriting history there would
-- corrupt the analytics. New submissions keep writing supplier_form /
-- partner_form as before.
