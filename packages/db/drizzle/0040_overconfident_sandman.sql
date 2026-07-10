CREATE TABLE "property_owner_contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"full_name" text NOT NULL,
	"email" text NOT NULL,
	"phone_number" text NOT NULL,
	"property_address" text NOT NULL,
	"property_location" text NOT NULL,
	"property_count" integer NOT NULL,
	"bedroom_count" integer NOT NULL,
	"notification_sent_at" timestamp with time zone,
	"notification_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "property_owner_contacts_property_count_check" CHECK ("property_owner_contacts"."property_count" >= 1),
	CONSTRAINT "property_owner_contacts_bedroom_count_check" CHECK ("property_owner_contacts"."bedroom_count" >= 0)
);
--> statement-breakpoint
CREATE INDEX "property_owner_contacts_created_at_idx" ON "property_owner_contacts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "property_owner_contacts_email_idx" ON "property_owner_contacts" USING btree ("email");