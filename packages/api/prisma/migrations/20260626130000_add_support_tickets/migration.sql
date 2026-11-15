-- ─── Support tickets ─────────────────────────────────────

CREATE TABLE "support_tickets" (
    "id"          UUID         NOT NULL,
    "user_id"     UUID,
    "name"        TEXT         NOT NULL,
    "email"       TEXT         NOT NULL,
    "phone"       TEXT,
    "subject"     TEXT         NOT NULL,
    "body"        TEXT         NOT NULL,
    "source"      TEXT         NOT NULL DEFAULT 'contact_form',
    "order_id"    UUID,
    "status"      TEXT         NOT NULL DEFAULT 'new',
    "admin_notes" TEXT,
    "language"    TEXT,
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "support_tickets_status_created_at_idx" ON "support_tickets"("status", "created_at");
CREATE INDEX "support_tickets_user_id_idx" ON "support_tickets"("user_id");
