ALTER TABLE "listing_review" ADD COLUMN "channel" text;--> statement-breakpoint
ALTER TABLE "listing_review" ADD COLUMN "channel_review_id" text;--> statement-breakpoint
ALTER TABLE "listing_review" ADD COLUMN "channel_listing_external_id" text;--> statement-breakpoint
CREATE INDEX "listing_review_channel_idx" ON "listing_review" USING btree ("provider","external_account_id","listing_external_id","channel");