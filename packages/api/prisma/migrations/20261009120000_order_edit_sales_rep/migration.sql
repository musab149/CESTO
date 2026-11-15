-- A sales rep editing an order they built.
--
-- `admin` would say an admin did it and then name nobody, since there is no
-- admins row to point at; `customer` reads as the client changing their own
-- order, which is the opposite of what happened. So the log gets a value of
-- its own and a column to hold the person.
--
-- Additive: one enum label, one nullable column. No backfill — every existing
-- row was written by one of the three actors that already existed.
--
-- NOTE for the promotion to master: this ALTER TYPE must not be applied twice
-- under different migration names. A duplicate enum label is what P3009-blocked
-- production on 2026-08-31; see the prod-enum-migration memory.

ALTER TYPE "OrderEditActor" ADD VALUE IF NOT EXISTS 'sales_rep';

ALTER TABLE "order_edit_logs" ADD COLUMN "editor_sales_rep_id" UUID;
