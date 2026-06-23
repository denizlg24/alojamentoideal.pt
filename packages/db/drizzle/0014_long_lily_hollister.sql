ALTER TABLE "orders" ADD COLUMN "stripe_payment_intent_id" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "date_of_birth" date;--> statement-breakpoint
CREATE UNIQUE INDEX "orders_stripe_payment_intent_id_uidx" ON "orders" USING btree ("stripe_payment_intent_id");