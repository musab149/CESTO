-- Cover photo on rashan packs, replacing the emoji as the primary visual.
--
-- Additive and nullable. Existing packs keep their emoji, which stays as the
-- fallback for packs with no cover and for a cover that fails to load.

ALTER TABLE "rashan_packs" ADD COLUMN "cover_url" TEXT;
