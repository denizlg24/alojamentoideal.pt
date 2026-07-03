ALTER TABLE "provider_bookings" ADD COLUMN "guest_reminder_email_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_bookings" ADD COLUMN "guest_reminder_email_last_error" text;--> statement-breakpoint
ALTER TABLE "provider_bookings" ADD COLUMN "guest_reminder_email_last_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "provider_bookings" ADD COLUMN "guest_reminder_email_next_at" timestamp with time zone DEFAULT now();--> statement-breakpoint
CREATE INDEX "provider_bookings_guest_reminder_due_idx" ON "provider_bookings" USING btree ("guest_reminder_email_next_at") WHERE "provider_bookings"."guest_reminder_email_next_at" is not null;--> statement-breakpoint
ALTER TABLE "provider_bookings" ADD CONSTRAINT "provider_bookings_guest_reminder_count_nonneg" CHECK ("provider_bookings"."guest_reminder_email_count" >= 0);