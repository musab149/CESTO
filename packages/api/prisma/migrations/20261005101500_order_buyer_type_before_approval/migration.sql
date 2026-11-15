-- Correct the backfill for orders placed BEFORE their buyer became a business.
--
-- The previous migration could only copy each account's CURRENT type, which
-- mislabels every order a customer placed while they were still retail. On
-- production that is 30 orders across two accounts — one upgraded 2026-09-21
-- with 23 earlier orders, one upgraded 2026-10-02 with 7 — about a quarter of
-- everything it had marked as wholesale.
--
-- BusinessProfile.approved_at is the moment the account actually became one,
-- so an order created before it was placed by a retail customer, whatever the
-- account is today. Orders at or after it keep `true`.
--
-- Accounts with is_business but no BusinessProfile row are left alone: there
-- is no approval date to compare against, so today's type remains the best
-- available answer for them.
UPDATE "orders" o
SET "buyer_is_business" = false
FROM "users" u
JOIN "business_profiles" bp ON bp."user_id" = u."id"
WHERE u."id" = o."user_id"
  AND u."is_business" = true
  AND o."created_at" < bp."approved_at"
  AND o."buyer_is_business" IS DISTINCT FROM false;
