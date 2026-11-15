-- CreateEnum
CREATE TYPE "RashanLeadFrequency" AS ENUM ('weekly', 'biweekly', 'every_3_weeks', 'monthly');

-- CreateEnum
CREATE TYPE "RashanLeadStatus" AS ENUM ('new', 'contacted', 'qualified', 'converted', 'closed', 'archived');

-- CreateEnum
CREATE TYPE "RashanLeadContactPref" AS ENUM ('whatsapp', 'call', 'sms', 'email');

-- CreateTable
CREATE TABLE "rashan_leads" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "language" TEXT,
    "household_size" INTEGER NOT NULL,
    "adults" INTEGER,
    "children" INTEGER,
    "frequency" "RashanLeadFrequency" NOT NULL,
    "preferred_start_date" TIMESTAMP(3),
    "interested_pack_slug" TEXT,
    "budget_per_cycle" DECIMAL(10,2),
    "dietary_notes" TEXT,
    "address_line" TEXT,
    "city" TEXT,
    "postcode" TEXT,
    "preferred_slot" TEXT,
    "contact_pref" "RashanLeadContactPref" NOT NULL DEFAULT 'whatsapp',
    "source" TEXT NOT NULL DEFAULT 'rashan_form',
    "status" "RashanLeadStatus" NOT NULL DEFAULT 'new',
    "notes" TEXT,
    "user_id" UUID,
    "converted_subscription_id" UUID,
    "converted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rashan_leads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rashan_leads_status_created_at_idx" ON "rashan_leads"("status", "created_at");

-- CreateIndex
CREATE INDEX "rashan_leads_created_at_idx" ON "rashan_leads"("created_at");
