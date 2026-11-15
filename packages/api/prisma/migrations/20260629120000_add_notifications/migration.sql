-- ─── Notifications ────────────────────────────────────────

CREATE TYPE "NotificationAudience" AS ENUM ('customer', 'admin');

CREATE TYPE "NotificationType" AS ENUM (
    'order_confirmed',
    'order_preparing',
    'order_on_the_way',
    'order_delivered',
    'order_cancelled',
    'promo_banner',
    'admin_new_order',
    'admin_low_stock',
    'admin_new_customer',
    'admin_subscription_paused',
    'admin_broadcast'
);

CREATE TABLE "notifications" (
    "id"         UUID                   NOT NULL,
    "audience"   "NotificationAudience" NOT NULL,
    "user_id"    UUID,
    "type"       "NotificationType"     NOT NULL,
    "title_es"   TEXT                   NOT NULL,
    "title_en"   TEXT                   NOT NULL,
    "body_es"    TEXT                   NOT NULL,
    "body_en"    TEXT                   NOT NULL,
    "deeplink"   TEXT,
    "read"       BOOLEAN                NOT NULL DEFAULT false,
    "read_at"    TIMESTAMP(3),
    "data"       JSONB,
    "created_at" TIMESTAMP(3)           NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "notifications_audience_created_at_idx"
    ON "notifications" ("audience", "created_at");
CREATE INDEX "notifications_user_id_read_created_at_idx"
    ON "notifications" ("user_id", "read", "created_at");

ALTER TABLE "notifications"
    ADD CONSTRAINT "notifications_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
