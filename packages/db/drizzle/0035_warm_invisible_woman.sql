CREATE TABLE "activity_item_details" (
	"order_item_id" text PRIMARY KEY NOT NULL,
	"activity_date" date NOT NULL,
	"answers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"bokun_activity_id" text NOT NULL,
	"external_account_id" text NOT NULL,
	"participants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provider" text NOT NULL,
	"rate_id" text,
	"start_time_id" text,
	"total_participants" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_quote_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"activity_date" date NOT NULL,
	"answers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"bokun_activity_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"currency" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"external_account_id" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"participants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provider" text NOT NULL,
	"provider_payload" jsonb,
	"rate_id" text,
	"start_time_id" text,
	"subtotal_minor" bigint NOT NULL,
	"tax_minor" bigint DEFAULT 0 NOT NULL,
	"total_minor" bigint NOT NULL,
	"total_participants" integer NOT NULL,
	"validation_status" text DEFAULT 'valid' NOT NULL,
	CONSTRAINT "activity_quote_snapshots_subtotal_minor_nonneg" CHECK ("activity_quote_snapshots"."subtotal_minor" >= 0),
	CONSTRAINT "activity_quote_snapshots_tax_minor_nonneg" CHECK ("activity_quote_snapshots"."tax_minor" >= 0),
	CONSTRAINT "activity_quote_snapshots_total_minor_nonneg" CHECK ("activity_quote_snapshots"."total_minor" >= 0),
	CONSTRAINT "activity_quote_snapshots_total_ge_tax" CHECK ("activity_quote_snapshots"."total_minor" >= "activity_quote_snapshots"."tax_minor"),
	CONSTRAINT "activity_quote_snapshots_total_participants_positive" CHECK ("activity_quote_snapshots"."total_participants" > 0),
	CONSTRAINT "activity_quote_snapshots_validation_status_check" CHECK ("activity_quote_snapshots"."validation_status" in ('valid', 'unavailable', 'expired', 'provider_error'))
);
--> statement-breakpoint
ALTER TABLE "cart_items" ALTER COLUMN "quote_snapshot_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "cart_items" ADD COLUMN "activity_quote_snapshot_id" text;--> statement-breakpoint
ALTER TABLE "activity_item_details" ADD CONSTRAINT "activity_item_details_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_item_details_activity_idx" ON "activity_item_details" USING btree ("provider","external_account_id","bokun_activity_id","activity_date");--> statement-breakpoint
CREATE INDEX "activity_quote_snapshots_scope_date_idx" ON "activity_quote_snapshots" USING btree ("provider","external_account_id","bokun_activity_id","activity_date");--> statement-breakpoint
CREATE INDEX "activity_quote_snapshots_expires_at_idx" ON "activity_quote_snapshots" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "activity_quote_snapshots_validation_status_idx" ON "activity_quote_snapshots" USING btree ("validation_status");--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_activity_quote_snapshot_id_activity_quote_snapshots_id_fk" FOREIGN KEY ("activity_quote_snapshot_id") REFERENCES "public"."activity_quote_snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_quote_snapshot_type_check" CHECK (("cart_items"."type" = 'accommodation' and "cart_items"."quote_snapshot_id" is not null and "cart_items"."activity_quote_snapshot_id" is null) or ("cart_items"."type" = 'activity' and "cart_items"."activity_quote_snapshot_id" is not null and "cart_items"."quote_snapshot_id" is null));
