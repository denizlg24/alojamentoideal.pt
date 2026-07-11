CREATE TABLE "listing_bookmark" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"external_account_id" text NOT NULL,
	"listing_external_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "listing_bookmark" ADD CONSTRAINT "listing_bookmark_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "listing_bookmark_user_listing_uidx" ON "listing_bookmark" USING btree ("user_id","provider","external_account_id","listing_external_id");--> statement-breakpoint
CREATE INDEX "listing_bookmark_user_idx" ON "listing_bookmark" USING btree ("user_id","created_at");