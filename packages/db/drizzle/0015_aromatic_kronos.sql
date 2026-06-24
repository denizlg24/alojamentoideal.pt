CREATE TABLE "user_profile" (
	"user_id" text PRIMARY KEY NOT NULL,
	"phone_e164" text,
	"is_company" boolean DEFAULT false NOT NULL,
	"company_name" text,
	"tax_number" text,
	"billing_line1" text,
	"billing_line2" text,
	"billing_city" text,
	"billing_region" text,
	"billing_postal_code" text,
	"billing_country" text,
	"residence_country" text,
	"nationality" text,
	"identity_verification_session_id" text,
	"identity_status" text DEFAULT 'unstarted' NOT NULL,
	"identity_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_profile_identity_status_check" CHECK ("user_profile"."identity_status" in ('unstarted', 'processing', 'requires_input', 'verified', 'canceled'))
);
--> statement-breakpoint
ALTER TABLE "user_profile" ADD CONSTRAINT "user_profile_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_profile_identity_status_idx" ON "user_profile" USING btree ("identity_status");--> statement-breakpoint
CREATE UNIQUE INDEX "user_profile_identity_session_uidx" ON "user_profile" USING btree ("identity_verification_session_id") WHERE "user_profile"."identity_verification_session_id" is not null;