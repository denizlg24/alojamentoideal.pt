CREATE TABLE "accommodation_listing" (
	"id" text PRIMARY KEY NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"bathrooms" double precision,
	"bedrooms" double precision,
	"city" text,
	"country" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"external_account_id" text NOT NULL,
	"external_id" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"name" text,
	"nickname" text,
	"normalized" jsonb NOT NULL,
	"person_capacity" double precision,
	"processed" jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	"processed_source_hash" text,
	"processing_error" text,
	"processing_status" text DEFAULT 'pending' NOT NULL,
	"property_type" text,
	"provider" text NOT NULL,
	"provider_updated_at" timestamp with time zone,
	"raw" jsonb NOT NULL,
	"section_hashes" jsonb NOT NULL,
	"source_hash" text NOT NULL,
	"stale_after" timestamp with time zone NOT NULL,
	"sync_run_id" text,
	"timezone" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_sync_run" (
	"id" text PRIMARY KEY NOT NULL,
	"error" text,
	"finished_at" timestamp with time zone,
	"listings_created" integer DEFAULT 0 NOT NULL,
	"listings_failed" integer DEFAULT 0 NOT NULL,
	"listings_seen" integer DEFAULT 0 NOT NULL,
	"listings_unchanged" integer DEFAULT 0 NOT NULL,
	"listings_updated" integer DEFAULT 0 NOT NULL,
	"provider" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text NOT NULL,
	"sync_type" text NOT NULL,
	"trigger" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accommodation_listing" ADD CONSTRAINT "accommodation_listing_sync_run_id_provider_sync_run_id_fk" FOREIGN KEY ("sync_run_id") REFERENCES "public"."provider_sync_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accommodation_listing_provider_external_uidx" ON "accommodation_listing" USING btree ("provider","external_account_id","external_id");--> statement-breakpoint
CREATE INDEX "accommodation_listing_active_city_idx" ON "accommodation_listing" USING btree ("active","city");--> statement-breakpoint
CREATE INDEX "accommodation_listing_provider_updated_at_idx" ON "accommodation_listing" USING btree ("provider","provider_updated_at");--> statement-breakpoint
CREATE INDEX "accommodation_listing_stale_after_idx" ON "accommodation_listing" USING btree ("stale_after");--> statement-breakpoint
CREATE INDEX "provider_sync_run_provider_started_at_idx" ON "provider_sync_run" USING btree ("provider","started_at");--> statement-breakpoint
CREATE INDEX "provider_sync_run_status_idx" ON "provider_sync_run" USING btree ("status");