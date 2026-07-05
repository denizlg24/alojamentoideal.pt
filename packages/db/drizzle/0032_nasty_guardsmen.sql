CREATE TABLE "activity_experience" (
	"id" text PRIMARY KEY NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"city" text,
	"country" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"detail" jsonb NOT NULL,
	"difficulty" text,
	"duration_bucket" text,
	"external_account_id" text NOT NULL,
	"external_id" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"from_price_amount" double precision,
	"from_price_currency" text,
	"provider" text NOT NULL,
	"raw" jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"source_hash" text NOT NULL,
	"stale_after" timestamp with time zone NOT NULL,
	"summary" jsonb NOT NULL,
	"sync_run_id" text,
	"title" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "provider_sync_run" ADD COLUMN "activities_created" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_sync_run" ADD COLUMN "activities_disabled" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_sync_run" ADD COLUMN "activities_failed" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_sync_run" ADD COLUMN "activities_seen" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_sync_run" ADD COLUMN "activities_unchanged" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_sync_run" ADD COLUMN "activities_updated" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "activity_experience" ADD CONSTRAINT "activity_experience_sync_run_id_provider_sync_run_id_fk" FOREIGN KEY ("sync_run_id") REFERENCES "public"."provider_sync_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "activity_experience_provider_external_uidx" ON "activity_experience" USING btree ("provider","external_account_id","external_id");--> statement-breakpoint
CREATE INDEX "activity_experience_active_sort_idx" ON "activity_experience" USING btree ("active","sort_order","external_id");--> statement-breakpoint
CREATE INDEX "activity_experience_city_idx" ON "activity_experience" USING btree ("city");--> statement-breakpoint
CREATE INDEX "activity_experience_stale_after_idx" ON "activity_experience" USING btree ("stale_after");