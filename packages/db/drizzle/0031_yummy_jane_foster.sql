CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listing_hostkit_credentials" (
	"listing_external_id" text PRIMARY KEY NOT NULL,
	"api_key_encrypted" "bytea" NOT NULL,
	"key_hint" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "listing_hostkit_credentials_hint_idx" ON "listing_hostkit_credentials" USING btree ("key_hint");