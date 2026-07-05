CREATE TABLE "order_refunds" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"order_item_id" text,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"reason" text DEFAULT 'requested_by_customer' NOT NULL,
	"note" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"stripe_refund_id" text,
	"stripe_refund_idempotency_key" text NOT NULL,
	"created_by_user_id" text,
	"last_error_message" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_refunds_amount_minor_positive" CHECK ("order_refunds"."amount_minor" > 0),
	CONSTRAINT "order_refunds_reason_check" CHECK ("order_refunds"."reason" in ('requested_by_customer', 'duplicate', 'fraudulent', 'other')),
	CONSTRAINT "order_refunds_status_check" CHECK ("order_refunds"."status" in ('pending', 'succeeded', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "order_refunds" ADD CONSTRAINT "order_refunds_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_refunds" ADD CONSTRAINT "order_refunds_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_refunds" ADD CONSTRAINT "order_refunds_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_refunds_order_idx" ON "order_refunds" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_refunds_order_item_idx" ON "order_refunds" USING btree ("order_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "order_refunds_idempotency_key_uidx" ON "order_refunds" USING btree ("stripe_refund_idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "order_refunds_stripe_refund_id_uidx" ON "order_refunds" USING btree ("stripe_refund_id") WHERE "order_refunds"."stripe_refund_id" is not null;