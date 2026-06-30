ALTER TABLE "conversations" DROP CONSTRAINT "conversations_provider_booking_order_fk";
--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "messages_sender_member_order_fk";
--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "delivery_status" SET DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "booking_guests" ADD COLUMN "order_id" text;--> statement-breakpoint
UPDATE "booking_guests"
SET "order_id" = "provider_bookings"."order_id"
FROM "provider_bookings"
WHERE "booking_guests"."provider_booking_id" = "provider_bookings"."id";--> statement-breakpoint
ALTER TABLE "booking_guests" ALTER COLUMN "order_id" SET NOT NULL;--> statement-breakpoint
UPDATE "order_members" AS "invited"
SET "invited_by_member_id" = NULL
WHERE "invited"."invited_by_member_id" IS NOT NULL
AND NOT EXISTS (
	SELECT 1
	FROM "order_members" AS "inviter"
	WHERE "inviter"."id" = "invited"."invited_by_member_id"
	AND "inviter"."order_id" = "invited"."order_id"
);--> statement-breakpoint
UPDATE "booking_guests" AS "guest"
SET "order_member_id" = NULL
WHERE "guest"."order_member_id" IS NOT NULL
AND NOT EXISTS (
	SELECT 1
	FROM "order_members" AS "member"
	WHERE "member"."id" = "guest"."order_member_id"
	AND "member"."order_id" = "guest"."order_id"
);--> statement-breakpoint
UPDATE "order_members"
SET "expires_at" = NULL
WHERE "role" = 'owner'
AND "expires_at" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_guests" ADD CONSTRAINT "booking_guests_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_guests" ADD CONSTRAINT "booking_guests_provider_booking_order_fk" FOREIGN KEY ("provider_booking_id","order_id") REFERENCES "public"."provider_bookings"("id","order_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_guests" ADD CONSTRAINT "booking_guests_order_member_order_fk" FOREIGN KEY ("order_member_id","order_id") REFERENCES "public"."order_members"("id","order_id") ON DELETE SET NULL ("order_member_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_provider_booking_order_fk" FOREIGN KEY ("provider_booking_id","order_id") REFERENCES "public"."provider_bookings"("id","order_id") ON DELETE SET NULL ("provider_booking_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_member_order_fk" FOREIGN KEY ("sender_member_id","order_id") REFERENCES "public"."order_members"("id","order_id") ON DELETE SET NULL ("sender_member_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_members" ADD CONSTRAINT "order_members_invited_by_member_order_fk" FOREIGN KEY ("invited_by_member_id","order_id") REFERENCES "public"."order_members"("id","order_id") ON DELETE SET NULL ("invited_by_member_id") ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_guests_order_id_idx" ON "booking_guests" USING btree ("order_id");--> statement-breakpoint
ALTER TABLE "order_members" ADD CONSTRAINT "order_members_owner_expires_null" CHECK ("order_members"."role" = 'member' or "order_members"."expires_at" is null);
