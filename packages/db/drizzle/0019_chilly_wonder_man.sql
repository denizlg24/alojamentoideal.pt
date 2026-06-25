ALTER TABLE "orders" ADD COLUMN "refund_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "refund_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "stripe_refund_id" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "stripe_refund_idempotency_key" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "finalization_email_attempt_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "finalization_email_kind" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "finalization_email_last_error" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "finalization_email_next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "finalization_email_sent_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "orders_stripe_refund_id_uidx" ON "orders" USING btree ("stripe_refund_id") WHERE "orders"."stripe_refund_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "orders_stripe_refund_idempotency_key_uidx" ON "orders" USING btree ("stripe_refund_idempotency_key") WHERE "orders"."stripe_refund_idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "orders_finalization_email_pending_idx" ON "orders" USING btree ("finalization_email_next_attempt_at") WHERE "orders"."finalization_email_kind" is not null and "orders"."finalization_email_sent_at" is null;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_amount_refunded_lte_paid" CHECK ("orders"."amount_refunded_minor" <= "orders"."amount_paid_minor");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_finalization_email_attempt_count_nonneg" CHECK ("orders"."finalization_email_attempt_count" >= 0);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_finalization_email_kind_check" CHECK ("orders"."finalization_email_kind" is null or "orders"."finalization_email_kind" in ('confirmation', 'refund_amount_mismatch', 'refund_unconfirmed'));
