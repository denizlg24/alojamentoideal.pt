ALTER TABLE "provider_bookings" ADD COLUMN "guest_reminder_email_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_bookings" ADD COLUMN "guest_reminder_email_last_error" text;--> statement-breakpoint
ALTER TABLE "provider_bookings" ADD COLUMN "guest_reminder_email_last_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "provider_bookings" ADD COLUMN "guest_reminder_email_next_at" timestamp with time zone;--> statement-breakpoint
UPDATE "provider_bookings"
SET "guest_reminder_email_next_at" = CASE
	WHEN "stay_starts_at" is null OR "stay_starts_at" <= now() THEN null
	WHEN least(
		interval '14 days',
		greatest(interval '4 hours', ("stay_starts_at" - now()) / 2)
	) < ("stay_starts_at" - now())
	THEN now() + least(
		interval '14 days',
		greatest(interval '4 hours', ("stay_starts_at" - now()) / 2)
	)
	ELSE null
END;--> statement-breakpoint
CREATE INDEX "provider_bookings_guest_reminder_due_idx" ON "provider_bookings" USING btree ("guest_reminder_email_next_at") WHERE "provider_bookings"."guest_reminder_email_next_at" is not null;--> statement-breakpoint
ALTER TABLE "provider_bookings" ADD CONSTRAINT "provider_bookings_guest_reminder_count_nonneg" CHECK ("provider_bookings"."guest_reminder_email_count" >= 0);
