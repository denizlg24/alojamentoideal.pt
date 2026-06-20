CREATE TABLE "listing_review" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"provider" text NOT NULL,
	"external_account_id" text NOT NULL,
	"external_id" text,
	"listing_external_id" text NOT NULL,
	"reservation_id" text,
	"guest_id" text,
	"guest_name" text,
	"user_id" text,
	"rating" double precision,
	"accuracy_rating" double precision,
	"checkin_rating" double precision,
	"clean_rating" double precision,
	"communication_rating" double precision,
	"location_rating" double precision,
	"value_rating" double precision,
	"comments" text,
	"language" text,
	"status" text DEFAULT 'published' NOT NULL,
	"reviewed_at" timestamp with time zone,
	"raw" jsonb,
	"sync_run_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listing_review_summary" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"external_account_id" text NOT NULL,
	"listing_external_id" text NOT NULL,
	"review_count" integer DEFAULT 0 NOT NULL,
	"rating_average" double precision,
	"external_count" integer DEFAULT 0 NOT NULL,
	"internal_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "listing_review" ADD CONSTRAINT "listing_review_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_review" ADD CONSTRAINT "listing_review_sync_run_id_provider_sync_run_id_fk" FOREIGN KEY ("sync_run_id") REFERENCES "public"."provider_sync_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "listing_review_provider_source_external_uidx" ON "listing_review" USING btree ("provider","external_account_id","source","external_id");--> statement-breakpoint
CREATE INDEX "listing_review_listing_idx" ON "listing_review" USING btree ("provider","external_account_id","listing_external_id");--> statement-breakpoint
CREATE INDEX "listing_review_source_idx" ON "listing_review" USING btree ("source");--> statement-breakpoint
CREATE UNIQUE INDEX "listing_review_summary_scope_uidx" ON "listing_review_summary" USING btree ("provider","external_account_id","listing_external_id");