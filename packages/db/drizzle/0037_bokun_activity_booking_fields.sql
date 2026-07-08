ALTER TABLE "activity_item_details" ADD COLUMN "dropoff_place_id" text;--> statement-breakpoint
ALTER TABLE "activity_item_details" ADD COLUMN "pickup_place_id" text;--> statement-breakpoint
ALTER TABLE "activity_item_details" ADD COLUMN "room_number" text;--> statement-breakpoint
ALTER TABLE "order_contacts" ADD COLUMN "date_of_birth" date;--> statement-breakpoint
ALTER TABLE "order_contacts" ADD COLUMN "first_name" text;--> statement-breakpoint
ALTER TABLE "order_contacts" ADD COLUMN "language" text;--> statement-breakpoint
ALTER TABLE "order_contacts" ADD COLUMN "last_name" text;