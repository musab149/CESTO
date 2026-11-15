-- A staff role that reaches only the document archive (2026-11-07).
--
-- ADD VALUE ONLY, in its own migration: nothing uses the value here, and a new
-- enum value cannot be used in the transaction that adds it. No existing admin
-- changes role and the column default stays `ops`.
ALTER TYPE "AdminRole" ADD VALUE IF NOT EXISTS 'lawyer';
