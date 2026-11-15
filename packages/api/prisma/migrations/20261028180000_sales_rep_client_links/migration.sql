-- A client a rep found by their exact email to order for them, though the
-- client stays whoever's it was (2026-10-28, lib/repClients).
--
-- Additive only: one new table. No existing row is read, changed or removed.
-- A row goes with its rep or its client.

-- CreateTable
CREATE TABLE "sales_rep_client_links" (
    "sales_rep_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "found_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_found_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_rep_client_links_pkey" PRIMARY KEY ("sales_rep_id","user_id")
);

-- CreateIndex
CREATE INDEX "sales_rep_client_links_user_id_idx" ON "sales_rep_client_links"("user_id");

-- AddForeignKey
ALTER TABLE "sales_rep_client_links" ADD CONSTRAINT "sales_rep_client_links_sales_rep_id_fkey" FOREIGN KEY ("sales_rep_id") REFERENCES "sales_reps"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_rep_client_links" ADD CONSTRAINT "sales_rep_client_links_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
