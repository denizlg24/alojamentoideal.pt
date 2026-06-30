ALTER TABLE "messages" ADD COLUMN "order_id" text;--> statement-breakpoint
ALTER TABLE "provider_bookings" ADD COLUMN "order_id" text;--> statement-breakpoint
UPDATE "provider_bookings"
SET "order_id" = "order_items"."order_id"
FROM "order_items"
WHERE "provider_bookings"."order_item_id" = "order_items"."id";--> statement-breakpoint
UPDATE "messages"
SET "order_id" = "conversations"."order_id"
FROM "conversations"
WHERE "messages"."conversation_id" = "conversations"."id";--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "order_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_bookings" ALTER COLUMN "order_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_id_order_id_uidx" ON "conversations" USING btree ("id","order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "order_items_id_order_id_uidx" ON "order_items" USING btree ("id","order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "order_members_id_order_id_uidx" ON "order_members" USING btree ("id","order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_bookings_id_order_id_uidx" ON "provider_bookings" USING btree ("id","order_id");--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_provider_booking_order_fk" FOREIGN KEY ("provider_booking_id","order_id") REFERENCES "public"."provider_bookings"("id","order_id") ON DELETE SET NULL ("provider_booking_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_order_fk" FOREIGN KEY ("conversation_id","order_id") REFERENCES "public"."conversations"("id","order_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_member_order_fk" FOREIGN KEY ("sender_member_id","order_id") REFERENCES "public"."order_members"("id","order_id") ON DELETE SET NULL ("sender_member_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_bookings" ADD CONSTRAINT "provider_bookings_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_bookings" ADD CONSTRAINT "provider_bookings_order_item_order_fk" FOREIGN KEY ("order_item_id","order_id") REFERENCES "public"."order_items"("id","order_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_order_id_idx" ON "messages" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "order_members_order_email_uidx" ON "order_members" USING btree ("order_id",lower("email")) WHERE "order_members"."status" <> 'revoked';
