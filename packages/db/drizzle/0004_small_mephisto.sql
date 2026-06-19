ALTER TABLE "accommodation_listing" ADD COLUMN "amenity_keys" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "accommodation_listing" ADD COLUMN "search_text" text;--> statement-breakpoint
ALTER TABLE "accommodation_listing" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce(search_text, ''))) STORED;--> statement-breakpoint
CREATE INDEX "accommodation_listing_lat_lng_idx" ON "accommodation_listing" USING btree ("latitude","longitude");--> statement-breakpoint
CREATE INDEX "accommodation_listing_search_vector_idx" ON "accommodation_listing" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "accommodation_listing_amenity_keys_idx" ON "accommodation_listing" USING gin ("amenity_keys");--> statement-breakpoint
-- Backfill search_text and amenity_keys for existing rows from processed content
-- (search_vector regenerates automatically). Mirrors buildListingSearchIndex.
UPDATE "accommodation_listing" SET
	"amenity_keys" = COALESCE((
		SELECT array_agg(DISTINCT COALESCE(a->>'id', a->>'sourceLabel'))
		FROM jsonb_array_elements(
			CASE WHEN jsonb_typeof("processed"->'amenities') = 'array'
				THEN "processed"->'amenities' ELSE '[]'::jsonb END
		) a
		WHERE COALESCE(a->>'id', a->>'sourceLabel') IS NOT NULL
	), '{}'::text[]),
	"search_text" = NULLIF(trim(concat_ws(' ',
		"name", "nickname", "city", "country", "property_type",
		"processed"->'title'->>'en', "processed"->'title'->>'pt', "processed"->'title'->>'es',
		"processed"->'description'->>'en', "processed"->'description'->>'pt', "processed"->'description'->>'es',
		(SELECT string_agg(concat_ws(' ',
			a->>'sourceLabel', a->'labels'->>'en', a->'labels'->>'pt', a->'labels'->>'es'
		), ' ')
		FROM jsonb_array_elements(
			CASE WHEN jsonb_typeof("processed"->'amenities') = 'array'
				THEN "processed"->'amenities' ELSE '[]'::jsonb END
		) a)
	)), '');
