CREATE TABLE "connected_account_transfers" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"order_item_id" text NOT NULL,
	"destination_account_id" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"stripe_transfer_id" text,
	"stripe_source_charge_id" text,
	"stripe_idempotency_key" text NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error_message" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connected_account_transfers_amount_positive" CHECK ("connected_account_transfers"."amount_minor" > 0),
	CONSTRAINT "connected_account_transfers_attempt_count_nonneg" CHECK ("connected_account_transfers"."attempt_count" >= 0),
	CONSTRAINT "connected_account_transfers_status_check" CHECK ("connected_account_transfers"."status" in ('pending', 'succeeded', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "accommodation_item_details" ADD COLUMN "stripe_connected_account_id" text;--> statement-breakpoint
ALTER TABLE "accommodation_listing" ADD COLUMN "pet_friendly" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "accommodation_listing" ADD COLUMN "stripe_connected_account_id" text;--> statement-breakpoint
ALTER TABLE "connected_account_transfers" ADD CONSTRAINT "connected_account_transfers_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connected_account_transfers" ADD CONSTRAINT "connected_account_transfers_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connected_account_transfers" ADD CONSTRAINT "connected_account_transfers_item_order_fk" FOREIGN KEY ("order_item_id","order_id") REFERENCES "public"."order_items"("id","order_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "connected_account_transfers_order_item_uidx" ON "connected_account_transfers" USING btree ("order_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "connected_account_transfers_idempotency_uidx" ON "connected_account_transfers" USING btree ("stripe_idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "connected_account_transfers_stripe_transfer_uidx" ON "connected_account_transfers" USING btree ("stripe_transfer_id") WHERE "connected_account_transfers"."stripe_transfer_id" is not null;--> statement-breakpoint
CREATE INDEX "connected_account_transfers_reconcile_idx" ON "connected_account_transfers" USING btree ("status","next_attempt_at");