-- CreateEnum
CREATE TYPE "RashanFrequency" AS ENUM ('biweekly', 'monthly', 'every_6_weeks');

-- CreateEnum
CREATE TYPE "RashanSubStatus" AS ENUM ('active', 'paused', 'cancelled');

-- CreateEnum
CREATE TYPE "SubDeliveryStatus" AS ENUM ('scheduled', 'awaiting_confirmation', 'confirmed', 'preparing', 'on_the_way', 'delivered', 'skipped', 'failed');

-- CreateTable
CREATE TABLE "rashan_packs" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name_es" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "tagline_es" TEXT,
    "tagline_en" TEXT,
    "description_es" TEXT,
    "description_en" TEXT,
    "badge_es" TEXT,
    "badge_en" TEXT,
    "emoji" TEXT,
    "gradient" TEXT,
    "accent" TEXT,
    "base_price" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "estimated_savings_pct" INTEGER NOT NULL DEFAULT 0,
    "household_default" INTEGER NOT NULL DEFAULT 2,
    "highlights_es" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "highlights_en" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "items" JSONB NOT NULL DEFAULT '[]',
    "is_custom" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rashan_packs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rashan_subscriptions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "pack_id" UUID,
    "pack_slug" TEXT,
    "items" JSONB NOT NULL DEFAULT '[]',
    "household" INTEGER NOT NULL DEFAULT 2,
    "frequency" "RashanFrequency" NOT NULL DEFAULT 'monthly',
    "status" "RashanSubStatus" NOT NULL DEFAULT 'active',
    "address_id" UUID NOT NULL,
    "slot_preference" TEXT,
    "payment_method" "PaymentMethod" NOT NULL DEFAULT 'cod',
    "next_delivery_date" TIMESTAMP(3),
    "needs_confirmation" BOOLEAN NOT NULL DEFAULT false,
    "total_per_cycle" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "cycles_completed" INTEGER NOT NULL DEFAULT 0,
    "paused_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancellation_reason" TEXT,
    "admin_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rashan_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_deliveries" (
    "id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "scheduled_date" TIMESTAMP(3) NOT NULL,
    "status" "SubDeliveryStatus" NOT NULL DEFAULT 'scheduled',
    "item_count" INTEGER NOT NULL DEFAULT 0,
    "total" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "order_id" UUID,
    "failure_reason" TEXT,
    "delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rashan_packs_slug_key" ON "rashan_packs"("slug");

-- CreateIndex
CREATE INDEX "rashan_packs_is_active_sort_order_idx" ON "rashan_packs"("is_active", "sort_order");

-- CreateIndex
CREATE INDEX "rashan_subscriptions_user_id_idx" ON "rashan_subscriptions"("user_id");

-- CreateIndex
CREATE INDEX "rashan_subscriptions_status_idx" ON "rashan_subscriptions"("status");

-- CreateIndex
CREATE INDEX "rashan_subscriptions_next_delivery_date_idx" ON "rashan_subscriptions"("next_delivery_date");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_deliveries_order_id_key" ON "subscription_deliveries"("order_id");

-- CreateIndex
CREATE INDEX "subscription_deliveries_subscription_id_idx" ON "subscription_deliveries"("subscription_id");

-- CreateIndex
CREATE INDEX "subscription_deliveries_status_idx" ON "subscription_deliveries"("status");

-- CreateIndex
CREATE INDEX "subscription_deliveries_scheduled_date_idx" ON "subscription_deliveries"("scheduled_date");

-- AddForeignKey
ALTER TABLE "rashan_subscriptions" ADD CONSTRAINT "rashan_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rashan_subscriptions" ADD CONSTRAINT "rashan_subscriptions_pack_id_fkey" FOREIGN KEY ("pack_id") REFERENCES "rashan_packs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rashan_subscriptions" ADD CONSTRAINT "rashan_subscriptions_address_id_fkey" FOREIGN KEY ("address_id") REFERENCES "addresses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_deliveries" ADD CONSTRAINT "subscription_deliveries_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "rashan_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_deliveries" ADD CONSTRAINT "subscription_deliveries_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
