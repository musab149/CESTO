-- Allow web_push_subscriptions rows to belong to either a customer (user_id)
-- or an admin (admin_id). Existing rows are customer subs — user_id stays
-- populated, admin_id defaults NULL. Enforcing exactly-one at the app layer.

ALTER TABLE "web_push_subscriptions"
  ALTER COLUMN "user_id" DROP NOT NULL;

ALTER TABLE "web_push_subscriptions"
  ADD COLUMN "admin_id" UUID;

ALTER TABLE "web_push_subscriptions"
  ADD CONSTRAINT "web_push_subscriptions_admin_id_fkey"
  FOREIGN KEY ("admin_id") REFERENCES "admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "web_push_subscriptions_admin_id_idx"
  ON "web_push_subscriptions"("admin_id");
