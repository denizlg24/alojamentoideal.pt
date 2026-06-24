CREATE TABLE "booking_guests" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_booking_id" text NOT NULL,
	"user_id" text,
	"user_identity_document_id" text,
	"position" integer NOT NULL,
	"identity_status" text DEFAULT 'missing' NOT NULL,
	"stripe_verification_session_id" text,
	"stripe_verification_report_id" text,
	"first_name_encrypted" "bytea",
	"last_name_encrypted" "bytea",
	"date_of_birth_encrypted" "bytea",
	"residence_country_encrypted" "bytea",
	"nationality_encrypted" "bytea",
	"document_type_encrypted" "bytea",
	"document_issuing_country_encrypted" "bytea",
	"document_number_encrypted" "bytea",
	"document_expires_on_encrypted" "bytea",
	"submitted_at" timestamp with time zone,
	"purge_after" timestamp with time zone,
	"purged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_guests_position_nonneg" CHECK ("booking_guests"."position" >= 0),
	CONSTRAINT "booking_guests_identity_status_check" CHECK ("booking_guests"."identity_status" in ('missing', 'provided', 'processing', 'requires_input', 'verified', 'canceled'))
);
--> statement-breakpoint
CREATE TABLE "guest_submission_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_booking_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"next_run_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"redacted_error_text" text,
	"external_result_reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guest_submission_jobs_status_check" CHECK ("guest_submission_jobs"."status" in ('pending', 'running', 'retrying', 'succeeded', 'failed', 'canceled')),
	CONSTRAINT "guest_submission_jobs_attempt_count_nonneg" CHECK ("guest_submission_jobs"."attempt_count" >= 0),
	CONSTRAINT "guest_submission_jobs_max_attempts_nonneg" CHECK ("guest_submission_jobs"."max_attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "provider_bookings" (
	"id" text PRIMARY KEY NOT NULL,
	"order_item_id" text NOT NULL,
	"provider" text NOT NULL,
	"external_account_id" text,
	"provider_reservation_id" text,
	"provider_status" text,
	"normalized_status" text DEFAULT 'pending' NOT NULL,
	"stay_starts_at" timestamp with time zone,
	"stay_ends_at" timestamp with time zone,
	"provider_created_at" timestamp with time zone,
	"provider_updated_at" timestamp with time zone,
	"raw_operational_payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_bookings_status_check" CHECK ("provider_bookings"."normalized_status" in ('pending', 'confirmed', 'cancelled', 'failed', 'completed'))
);
--> statement-breakpoint
CREATE TABLE "user_identity_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"source" text DEFAULT 'stripe_identity' NOT NULL,
	"status" text DEFAULT 'requires_input' NOT NULL,
	"stripe_verification_session_id" text,
	"stripe_verification_report_id" text,
	"first_name_encrypted" "bytea",
	"last_name_encrypted" "bytea",
	"date_of_birth_encrypted" "bytea",
	"document_type_encrypted" "bytea",
	"document_issuing_country_encrypted" "bytea",
	"document_number_encrypted" "bytea",
	"document_expires_on_encrypted" "bytea",
	"nationality_encrypted" "bytea",
	"submitted_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"purge_after" timestamp with time zone,
	"purged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_identity_documents_status_check" CHECK ("user_identity_documents"."status" in ('processing', 'requires_input', 'verified', 'canceled')),
	CONSTRAINT "user_identity_documents_source_check" CHECK ("user_identity_documents"."source" in ('stripe_identity'))
);
--> statement-breakpoint
COMMENT ON COLUMN "booking_guests"."first_name_encrypted" IS 'Encrypted before insert. Decryption is limited to booking prefill, profile display, and compliance submission paths.';--> statement-breakpoint
COMMENT ON COLUMN "booking_guests"."last_name_encrypted" IS 'Encrypted before insert. Decryption is limited to booking prefill, profile display, and compliance submission paths.';--> statement-breakpoint
COMMENT ON COLUMN "booking_guests"."date_of_birth_encrypted" IS 'Encrypted before insert. Decryption is limited to booking prefill, profile display, and compliance submission paths.';--> statement-breakpoint
COMMENT ON COLUMN "booking_guests"."residence_country_encrypted" IS 'Encrypted before insert. Decryption is limited to booking prefill, profile display, and compliance submission paths.';--> statement-breakpoint
COMMENT ON COLUMN "booking_guests"."nationality_encrypted" IS 'Encrypted before insert. Decryption is limited to booking prefill, profile display, and compliance submission paths.';--> statement-breakpoint
COMMENT ON COLUMN "booking_guests"."document_type_encrypted" IS 'Encrypted before insert. Decryption is limited to booking prefill, profile display, and compliance submission paths.';--> statement-breakpoint
COMMENT ON COLUMN "booking_guests"."document_issuing_country_encrypted" IS 'Encrypted before insert. Decryption is limited to booking prefill, profile display, and compliance submission paths.';--> statement-breakpoint
COMMENT ON COLUMN "booking_guests"."document_number_encrypted" IS 'Encrypted before insert. Decryption is limited to booking prefill, profile display, and compliance submission paths.';--> statement-breakpoint
COMMENT ON COLUMN "booking_guests"."document_expires_on_encrypted" IS 'Encrypted before insert. Decryption is limited to booking prefill, profile display, and compliance submission paths.';--> statement-breakpoint
COMMENT ON COLUMN "user_identity_documents"."first_name_encrypted" IS 'Encrypted before insert. Decryption is limited to profile display, booking prefill, and compliance submission paths.';--> statement-breakpoint
COMMENT ON COLUMN "user_identity_documents"."last_name_encrypted" IS 'Encrypted before insert. Decryption is limited to profile display, booking prefill, and compliance submission paths.';--> statement-breakpoint
COMMENT ON COLUMN "user_identity_documents"."date_of_birth_encrypted" IS 'Encrypted before insert. Decryption is limited to profile display, booking prefill, and compliance submission paths.';--> statement-breakpoint
COMMENT ON COLUMN "user_identity_documents"."document_type_encrypted" IS 'Encrypted before insert. Decryption is limited to profile display, booking prefill, and compliance submission paths.';--> statement-breakpoint
COMMENT ON COLUMN "user_identity_documents"."document_issuing_country_encrypted" IS 'Encrypted before insert. Decryption is limited to profile display, booking prefill, and compliance submission paths.';--> statement-breakpoint
COMMENT ON COLUMN "user_identity_documents"."document_number_encrypted" IS 'Encrypted before insert. Decryption is limited to profile display, booking prefill, and compliance submission paths.';--> statement-breakpoint
COMMENT ON COLUMN "user_identity_documents"."document_expires_on_encrypted" IS 'Encrypted before insert. Decryption is limited to profile display, booking prefill, and compliance submission paths.';--> statement-breakpoint
COMMENT ON COLUMN "user_identity_documents"."nationality_encrypted" IS 'Encrypted before insert. Decryption is limited to profile display, booking prefill, and compliance submission paths.';--> statement-breakpoint
ALTER TABLE "user_profile" DROP CONSTRAINT "user_profile_identity_status_check";--> statement-breakpoint
DROP INDEX "user_profile_identity_status_idx";--> statement-breakpoint
DROP INDEX "user_profile_identity_session_uidx";--> statement-breakpoint
ALTER TABLE "booking_guests" ADD CONSTRAINT "booking_guests_provider_booking_id_provider_bookings_id_fk" FOREIGN KEY ("provider_booking_id") REFERENCES "public"."provider_bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_guests" ADD CONSTRAINT "booking_guests_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_guests" ADD CONSTRAINT "booking_guests_user_identity_document_id_user_identity_documents_id_fk" FOREIGN KEY ("user_identity_document_id") REFERENCES "public"."user_identity_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_submission_jobs" ADD CONSTRAINT "guest_submission_jobs_provider_booking_id_provider_bookings_id_fk" FOREIGN KEY ("provider_booking_id") REFERENCES "public"."provider_bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_bookings" ADD CONSTRAINT "provider_bookings_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_identity_documents" ADD CONSTRAINT "user_identity_documents_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "booking_guests_booking_position_uidx" ON "booking_guests" USING btree ("provider_booking_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_guests_stripe_session_uidx" ON "booking_guests" USING btree ("stripe_verification_session_id") WHERE "booking_guests"."stripe_verification_session_id" is not null;--> statement-breakpoint
CREATE INDEX "booking_guests_provider_booking_idx" ON "booking_guests" USING btree ("provider_booking_id");--> statement-breakpoint
CREATE INDEX "booking_guests_user_idx" ON "booking_guests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "booking_guests_identity_document_idx" ON "booking_guests" USING btree ("user_identity_document_id");--> statement-breakpoint
CREATE INDEX "booking_guests_purge_after_idx" ON "booking_guests" USING btree ("purge_after");--> statement-breakpoint
CREATE INDEX "guest_submission_jobs_booking_status_idx" ON "guest_submission_jobs" USING btree ("provider_booking_id","status");--> statement-breakpoint
CREATE INDEX "guest_submission_jobs_status_next_run_idx" ON "guest_submission_jobs" USING btree ("status","next_run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_bookings_order_item_uidx" ON "provider_bookings" USING btree ("order_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_bookings_provider_reservation_uidx" ON "provider_bookings" USING btree ("provider","external_account_id","provider_reservation_id") WHERE "provider_bookings"."provider_reservation_id" is not null;--> statement-breakpoint
CREATE INDEX "provider_bookings_provider_date_idx" ON "provider_bookings" USING btree ("provider","stay_starts_at","stay_ends_at");--> statement-breakpoint
CREATE INDEX "provider_bookings_status_idx" ON "provider_bookings" USING btree ("normalized_status");--> statement-breakpoint
CREATE INDEX "user_identity_documents_user_status_idx" ON "user_identity_documents" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "user_identity_documents_purge_after_idx" ON "user_identity_documents" USING btree ("purge_after");--> statement-breakpoint
CREATE UNIQUE INDEX "user_identity_documents_active_verified_uidx" ON "user_identity_documents" USING btree ("user_id") WHERE "user_identity_documents"."status" = 'verified' and "user_identity_documents"."purged_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "user_identity_documents_stripe_session_uidx" ON "user_identity_documents" USING btree ("stripe_verification_session_id") WHERE "user_identity_documents"."stripe_verification_session_id" is not null;--> statement-breakpoint
ALTER TABLE "user_profile" DROP COLUMN "identity_verification_session_id";--> statement-breakpoint
ALTER TABLE "user_profile" DROP COLUMN "identity_status";--> statement-breakpoint
ALTER TABLE "user_profile" DROP COLUMN "identity_verified_at";
