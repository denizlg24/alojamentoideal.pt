ALTER TABLE "provider_bookings" ADD COLUMN "attempt_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_bookings" ADD COLUMN "last_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "provider_bookings" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "provider_bookings" ADD COLUMN "last_error_code" text;--> statement-breakpoint
ALTER TABLE "provider_bookings" ADD COLUMN "last_error_message" text;--> statement-breakpoint
ALTER TABLE "provider_bookings" ADD COLUMN "needs_recovery" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "provider_bookings" SET "needs_recovery" = true, "last_error_code" = 'legacy_pending_manual_recovery', "last_error_message" = 'Legacy pending booking predates retry scheduling; verify provider state before enabling automatic retry.', "next_attempt_at" = now(), "updated_at" = now() WHERE "normalized_status" = 'pending';--> statement-breakpoint
UPDATE "provider_bookings" SET "next_attempt_at" = now() WHERE "next_attempt_at" IS NULL;--> statement-breakpoint
ALTER TABLE "provider_bookings" ALTER COLUMN "next_attempt_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "provider_bookings" ALTER COLUMN "next_attempt_at" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "provider_bookings_pending_next_attempt_idx" ON "provider_bookings" USING btree ("next_attempt_at") WHERE "provider_bookings"."normalized_status" = 'pending';--> statement-breakpoint
ALTER TABLE "provider_bookings" ADD CONSTRAINT "provider_bookings_attempt_count_nonneg" CHECK ("provider_bookings"."attempt_count" >= 0);
