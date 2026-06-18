CREATE TABLE "observability_event" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"duration_ms" integer,
	"ip_hash" text,
	"metadata" jsonb,
	"method" text,
	"name" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provider" text,
	"request_id" text,
	"route" text,
	"severity" text DEFAULT 'info' NOT NULL,
	"source" text,
	"status_code" integer,
	"type" text NOT NULL,
	"user_id" text
);
--> statement-breakpoint
CREATE INDEX "observability_event_type_occurred_at_idx" ON "observability_event" USING btree ("type","occurred_at");--> statement-breakpoint
CREATE INDEX "observability_event_occurred_at_idx" ON "observability_event" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "observability_event_name_idx" ON "observability_event" USING btree ("name");--> statement-breakpoint
CREATE INDEX "observability_event_route_idx" ON "observability_event" USING btree ("route");--> statement-breakpoint
CREATE INDEX "observability_event_status_code_idx" ON "observability_event" USING btree ("status_code");