CREATE TABLE "provider_sync_state" (
	"id" text PRIMARY KEY NOT NULL,
	"active_run_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"error" text,
	"external_account_id" text NOT NULL,
	"last_completed_at" timestamp with time zone,
	"last_started_at" timestamp with time zone,
	"lease_expires_at" timestamp with time zone,
	"next_page" integer DEFAULT 1 NOT NULL,
	"next_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provider" text NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"sync_type" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "provider_sync_state_scope_uidx" ON "provider_sync_state" USING btree ("provider","external_account_id","sync_type");--> statement-breakpoint
CREATE INDEX "provider_sync_state_next_run_at_idx" ON "provider_sync_state" USING btree ("next_run_at");--> statement-breakpoint
CREATE INDEX "provider_sync_state_lease_expires_at_idx" ON "provider_sync_state" USING btree ("lease_expires_at");