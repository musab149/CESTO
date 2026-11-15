-- Which kind of account placed this order, recorded AT THE TIME.
--
-- The admin order books read the buyer's type to decide which list an order
-- belongs in. That was read live off the user, so changing someone from B2C
-- to B2B moved every order they had ever placed into another book and
-- rewrote past revenue splits. An order is a historical fact; the account it
-- belongs to is not.
--
-- Nullable rather than NOT NULL DEFAULT: null means "this row predates the
-- column", which the filters fall back to the live user for. A default would
-- claim every historical order was retail, which is a worse lie than the one
-- being fixed.
ALTER TABLE "orders" ADD COLUMN "buyer_is_business" BOOLEAN;

-- Backfill from the account's CURRENT type. It is the best available
-- approximation and the only one that is true for every order placed since
-- the last type change — which, until today, was most of them, because the
-- type could not change at all between 2026-10-04 and this migration.
UPDATE "orders" o
SET "buyer_is_business" = u."is_business"
FROM "users" u
WHERE u."id" = o."user_id";

CREATE INDEX "orders_buyer_is_business_idx" ON "orders"("buyer_is_business");
