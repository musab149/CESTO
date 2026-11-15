-- Singleton config store, same shape as home_sections. Currently holds
-- one row with key = 'store' — the admin Settings page persists every
-- field into this row's JSON config blob.
CREATE TABLE "app_settings" (
  "key"        TEXT NOT NULL,
  "config"     JSONB NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);
