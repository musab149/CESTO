-- ─── Product import jobs ──────────────────────────────
-- Backs the async worker introduced in Layer 3 of the import UX overhaul.
-- POST /api/admin/products/import inserts a row here in state 'queued'
-- and returns its id; a same-process worker (setImmediate) picks it up
-- and updates `processed` as it inserts rows. The admin UI polls
-- GET /jobs/:id and shows the final `result` JSON when status = done.
--
-- Additive migration. No existing rows touched.

CREATE TYPE "ImportJobStatus" AS ENUM (
    'queued',
    'running',
    'done',
    'failed',
    'interrupted'
);

CREATE TABLE "product_import_jobs" (
    "id"              UUID              NOT NULL,
    "admin_id"        UUID              NOT NULL,
    "idempotency_key" TEXT              NOT NULL,
    "status"          "ImportJobStatus" NOT NULL DEFAULT 'queued',
    "total"           INTEGER,
    "processed"       INTEGER           NOT NULL DEFAULT 0,
    "result"          JSONB,
    "error_message"   TEXT,
    "filename"        TEXT              NOT NULL,
    "file_size"       INTEGER           NOT NULL,
    "created_at"      TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at"      TIMESTAMP(3),
    "finished_at"     TIMESTAMP(3),

    CONSTRAINT "product_import_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "product_import_jobs_admin_id_created_at_idx"
    ON "product_import_jobs" ("admin_id", "created_at");

CREATE INDEX "product_import_jobs_idempotency_key_idx"
    ON "product_import_jobs" ("idempotency_key");

CREATE INDEX "product_import_jobs_status_idx"
    ON "product_import_jobs" ("status");

ALTER TABLE "product_import_jobs"
    ADD CONSTRAINT "product_import_jobs_admin_id_fkey"
    FOREIGN KEY ("admin_id") REFERENCES "admins" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
