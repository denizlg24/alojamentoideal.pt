ALTER TABLE "orders" ADD COLUMN "stripe_payment_method_brand" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "stripe_payment_method_last4" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "stripe_payment_method_type" text;