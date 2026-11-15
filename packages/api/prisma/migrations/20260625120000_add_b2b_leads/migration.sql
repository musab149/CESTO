-- Inbound B2B applications + sales enquiries from the customer /b2b-deals
-- page. Admins triage them from /leads in the dashboard.
CREATE TABLE "b2b_leads" (
  "id"              UUID NOT NULL DEFAULT gen_random_uuid(),
  "type"            TEXT NOT NULL,
  "source"          TEXT NOT NULL,
  "name"            TEXT NOT NULL,
  "company"         TEXT NOT NULL,
  "email"           TEXT NOT NULL,
  "phone"           TEXT NOT NULL,
  "location"        TEXT,
  "business_type"   TEXT,
  "website"         TEXT,
  "registration_no" TEXT,
  "message"         TEXT,
  "intent"          TEXT,
  "status"          TEXT NOT NULL DEFAULT 'new',
  "notes"           TEXT,
  "language"        TEXT,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "b2b_leads_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "b2b_leads_status_created_at_idx" ON "b2b_leads"("status", "created_at");
CREATE INDEX "b2b_leads_type_created_at_idx"   ON "b2b_leads"("type", "created_at");
