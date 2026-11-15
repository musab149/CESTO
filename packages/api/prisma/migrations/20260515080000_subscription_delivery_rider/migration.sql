-- Allow riders to be assigned to individual subscription deliveries before
-- the cycle materializes into an Order. Ops needs this so they can plan
-- routes ahead of time, and customers need it so the upcoming-delivery card
-- can show who's bringing the next pack.

ALTER TABLE "subscription_deliveries"
  ADD COLUMN "rider_id" UUID;

ALTER TABLE "subscription_deliveries"
  ADD CONSTRAINT "subscription_deliveries_rider_id_fkey"
  FOREIGN KEY ("rider_id") REFERENCES "riders"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "subscription_deliveries_rider_id_idx"
  ON "subscription_deliveries"("rider_id");
