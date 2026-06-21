CREATE TABLE "accommodation_listing_night" (
	"id" text PRIMARY KEY NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"base_price" double precision,
	"currency" text,
	"date" date NOT NULL,
	"external_account_id" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"listing_external_id" text NOT NULL,
	"min_stay" integer,
	"price" double precision,
	"provider" text NOT NULL,
	"raw" jsonb NOT NULL,
	"reservation_id" text,
	"stale_after" timestamp with time zone NOT NULL,
	"status" text,
	"sync_run_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accommodation_listing_night" ADD CONSTRAINT "accommodation_listing_night_sync_run_id_provider_sync_run_id_fk" FOREIGN KEY ("sync_run_id") REFERENCES "public"."provider_sync_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accommodation_listing_night_scope_date_uidx" ON "accommodation_listing_night" USING btree ("provider","external_account_id","listing_external_id","date");--> statement-breakpoint
CREATE INDEX "accommodation_listing_night_listing_date_idx" ON "accommodation_listing_night" USING btree ("provider","external_account_id","listing_external_id","date");--> statement-breakpoint
CREATE INDEX "accommodation_listing_night_date_idx" ON "accommodation_listing_night" USING btree ("date");--> statement-breakpoint
CREATE INDEX "accommodation_listing_night_stale_after_idx" ON "accommodation_listing_night" USING btree ("stale_after");