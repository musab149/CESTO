-- Wipe existing banners — schema overhaul changes the editable surface.
DELETE FROM "banners";

-- Drop legacy single-language columns
ALTER TABLE "banners" DROP COLUMN "title";
ALTER TABLE "banners" DROP COLUMN "subtitle";

-- Bilingual content
ALTER TABLE "banners" ADD COLUMN "eyebrow_en"   TEXT;
ALTER TABLE "banners" ADD COLUMN "eyebrow_es"   TEXT;
ALTER TABLE "banners" ADD COLUMN "title_en"     TEXT NOT NULL DEFAULT '';
ALTER TABLE "banners" ADD COLUMN "title_es"     TEXT NOT NULL DEFAULT '';
ALTER TABLE "banners" ADD COLUMN "subtitle_en"  TEXT;
ALTER TABLE "banners" ADD COLUMN "subtitle_es"  TEXT;
ALTER TABLE "banners" ADD COLUMN "cta_en"       TEXT;
ALTER TABLE "banners" ADD COLUMN "cta_es"       TEXT;

-- Visual style
ALTER TABLE "banners" ADD COLUMN "background"   TEXT;
ALTER TABLE "banners" ADD COLUMN "text_theme"   TEXT NOT NULL DEFAULT 'dark';
ALTER TABLE "banners" ADD COLUMN "accent_color" VARCHAR(9);
ALTER TABLE "banners" ADD COLUMN "scrim_color"  VARCHAR(9);
ALTER TABLE "banners" ADD COLUMN "show_eyebrow" BOOLEAN NOT NULL DEFAULT false;
