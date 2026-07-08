ALTER TABLE "order_refunds" ADD COLUMN "stripe_transfer_reversal_id" text;--> statement-breakpoint
ALTER TABLE "order_refunds" ADD COLUMN "transfer_reversal_amount_minor" bigint;