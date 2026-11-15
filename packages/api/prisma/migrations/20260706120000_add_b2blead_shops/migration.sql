-- Add multi-shop payload column to B2B leads. Nullable JSONB so existing
-- rows stay valid; new supplier/partner submissions carry an array of
-- { name, address, lat, lng, place_id?, city?, postcode?, country? } entries.
ALTER TABLE "b2b_leads" ADD COLUMN "shops" JSONB;
