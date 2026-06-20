ALTER TABLE "accommodation_listing" ADD COLUMN "beds" double precision;--> statement-breakpoint
-- Backfill from the stored raw Hostify payload so existing rows reflect the real
-- bed count immediately, instead of waiting for the next sync to change
-- source_hash. New/updated listings populate `beds` from the projection.
UPDATE "accommodation_listing"
SET "beds" = ("raw"->'listing'->>'beds')::double precision
WHERE "raw"->'listing' ? 'beds'
	AND ("raw"->'listing'->>'beds') ~ '^[0-9]+(\.[0-9]+)?$';