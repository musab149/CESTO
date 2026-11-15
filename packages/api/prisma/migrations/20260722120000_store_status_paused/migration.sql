-- ─── Store status: add 'paused' ────────────────────────────
-- Self-serve visibility state for partners (2026-07-22). Partner can flip
-- their own store between 'live' and 'paused' from the partner dashboard;
-- admin retains full control of all four values (draft / live / paused /
-- suspended).
--
-- Additive-only per the multi-vendor roadmap's ground rule #1: existing
-- rows keep their current value, nothing reads 'paused' yet, no default
-- change, no data migration. `customerVisibleStoreFilter` (status='live')
-- already excludes it — that's why the partner UX can ship as a pure
-- code addition once this enum value exists.
--
-- Postgres allows ADD VALUE outside a transaction on 12+; Render's Neon
-- instances are far past that so no special --commit flag is needed.

ALTER TYPE "StoreStatus" ADD VALUE 'paused';
