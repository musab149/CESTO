-- Corrective backfill for 20260727120000_b2b_business_accounts.
--
-- That migration remapped every type='partner' row to 'business', on the
-- basis that /b2b-deals (which submitted 'partner') is the wholesale-buyer
-- form. That is true of the form's INTENT, but not of what actually happened
-- to rows that were already approved: the old approve endpoint accepted
-- type='partner' and created a Store + PartnerStoreRole. Those applicants
-- are running partner stores today.
--
-- Relabelling them 'business' would move live partner stores out of the
-- Partner deals tab and into the B2B leads tab, and would imply they hold a
-- wholesale-pricing account they were never granted.
--
-- `approved_store_id IS NOT NULL` is the decisive signal: a Store exists, so
-- whatever the applicant originally meant, this lead IS a partner store.
--
-- Idempotent (the predicate stops matching once corrected) and safe to run
-- on a fresh database, where it simply matches nothing.

UPDATE "b2b_leads"
   SET "type" = 'partner_store'
 WHERE "type" = 'business'
   AND "approved_store_id" IS NOT NULL;

-- Rows left as 'business' are the ones that were never approved into a store:
-- pending, needs_info, and rejected applications. Those are genuine wholesale
-- buyer applications and belong in the new business funnel.
