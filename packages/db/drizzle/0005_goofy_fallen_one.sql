CREATE EXTENSION IF NOT EXISTS unaccent;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
-- Immutable wrapper so unaccent can be used in generated columns and indexes.
CREATE OR REPLACE FUNCTION immutable_unaccent(text)
	RETURNS text
	LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
	AS $$ SELECT public.unaccent($1) $$;--> statement-breakpoint
-- Weighted full-text source columns. `search_text` is repurposed as the body
-- (C) tier; `search_title` (A) and `search_location` (B) are new.
ALTER TABLE "accommodation_listing" ADD COLUMN "search_location" text;--> statement-breakpoint
ALTER TABLE "accommodation_listing" ADD COLUMN "search_title" text;--> statement-breakpoint
-- Replace the unweighted vector with a weighted, accent-folded one.
DROP INDEX IF EXISTS "accommodation_listing_search_vector_idx";--> statement-breakpoint
ALTER TABLE "accommodation_listing" DROP COLUMN "search_vector";--> statement-breakpoint
ALTER TABLE "accommodation_listing" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (
	setweight(to_tsvector('simple', immutable_unaccent(coalesce(search_title, ''))), 'A')
	|| setweight(to_tsvector('simple', immutable_unaccent(coalesce(search_location, ''))), 'B')
	|| setweight(to_tsvector('simple', immutable_unaccent(coalesce(search_text, ''))), 'C')
) STORED;--> statement-breakpoint
CREATE INDEX "accommodation_listing_search_vector_idx" ON "accommodation_listing" USING gin ("search_vector");--> statement-breakpoint
-- Trigram indexes backing typo-tolerant, accent/case-insensitive place filters.
CREATE INDEX "accommodation_listing_city_trgm_idx" ON "accommodation_listing" USING gin (immutable_unaccent(lower("city")) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "accommodation_listing_country_trgm_idx" ON "accommodation_listing" USING gin (immutable_unaccent(lower("country")) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "accommodation_listing_property_type_trgm_idx" ON "accommodation_listing" USING gin (immutable_unaccent(lower("property_type")) gin_trgm_ops);--> statement-breakpoint
-- Backfill the weighted source columns from processed content + typed columns
-- (mirrors buildListingSearchIndex). search_vector regenerates automatically.
UPDATE "accommodation_listing" SET
	"search_title" = NULLIF(trim((
		SELECT string_agg(DISTINCT trimmed_value, ' ')
		FROM (
			SELECT trim(value) AS trimmed_value
			FROM unnest(ARRAY[
				"name", "nickname",
				"processed"->'title'->>'en', "processed"->'title'->>'pt', "processed"->'title'->>'es'
			]) AS value
			WHERE trim(value) != ''
		) AS unique_values
	)), ''),
	"search_location" = NULLIF(trim((
		SELECT string_agg(DISTINCT trimmed_value, ' ')
		FROM (
			SELECT trim(value) AS trimmed_value
			FROM unnest(ARRAY["city", "country", "property_type"]) AS value
			WHERE trim(value) != ''
		) AS unique_values
	)), ''),
	"search_text" = NULLIF(trim((
		SELECT string_agg(DISTINCT trimmed_value, ' ')
		FROM (
			SELECT trim(value) AS trimmed_value
			FROM unnest(
				ARRAY[
					"processed"->'description'->>'en',
					"processed"->'description'->>'pt',
					"processed"->'description'->>'es'
				] || COALESCE((
					SELECT array_agg(term)
					FROM (
						SELECT DISTINCT trim(unnest(string_to_array(concat_ws(' ',
							a->>'sourceLabel', a->'labels'->>'en', a->'labels'->>'pt', a->'labels'->>'es'
						), ' '))) AS term
						FROM jsonb_array_elements(
							CASE WHEN jsonb_typeof("processed"->'amenities') = 'array'
								THEN "processed"->'amenities' ELSE '[]'::jsonb END
						) a
					) amenity_terms
				), '{}'::text[])
			) AS value
			WHERE trim(value) != ''
		) AS unique_values
	)), '');
