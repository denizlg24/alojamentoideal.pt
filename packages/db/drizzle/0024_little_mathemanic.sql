ALTER TABLE "booking_guests" ADD COLUMN "order_member_id" text;--> statement-breakpoint  
ALTER TABLE "booking_guests" ADD CONSTRAINT "booking_guests_order_member_id_order_members_id_fk" FOREIGN KEY ("order_member_id") REFERENCES "public"."order_members"("id") ON DELETE set null ON UPDATE no action NOT VALID;--> statement-breakpoint  
ALTER TABLE "booking_guests" VALIDATE CONSTRAINT "booking_guests_order_member_id_order_members_id_fk";--> statement-breakpoint  
CREATE INDEX "booking_guests_order_member_idx" ON "booking_guests" USING btree ("order_member_id") WHERE "booking_guests"."order_member_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "booking_guests_booking_member_uidx" ON "booking_guests" USING btree ("provider_booking_id","order_member_id") WHERE "booking_guests"."order_member_id" is not null;
