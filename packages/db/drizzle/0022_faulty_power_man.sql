CREATE TABLE "conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"provider_booking_id" text,
	"provider" text NOT NULL,
	"external_thread_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"last_message_at" timestamp with time zone,
	"last_message_preview" text,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_status_check" CHECK ("conversations"."status" in ('pending', 'active', 'archived')),
	CONSTRAINT "conversations_unread_count_nonneg" CHECK ("conversations"."unread_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"external_message_id" text,
	"sender_type" text NOT NULL,
	"sender_member_id" text,
	"body" text NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"read_at" timestamp with time zone,
	"is_automatic" boolean DEFAULT false NOT NULL,
	"delivery_status" text DEFAULT 'pending' NOT NULL,
	"raw_payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_sender_type_check" CHECK ("messages"."sender_type" in ('guest', 'host', 'system')),
	CONSTRAINT "messages_delivery_status_check" CHECK ("messages"."delivery_status" in ('pending', 'sent', 'failed')),
	CONSTRAINT "messages_body_not_empty" CHECK (length(trim("messages"."body")) > 0)
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_provider_booking_id_provider_bookings_id_fk" FOREIGN KEY ("provider_booking_id") REFERENCES "public"."provider_bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_member_id_order_members_id_fk" FOREIGN KEY ("sender_member_id") REFERENCES "public"."order_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversations_order_id_idx" ON "conversations" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_provider_booking_uidx" ON "conversations" USING btree ("provider_booking_id") WHERE "conversations"."provider_booking_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_provider_thread_uidx" ON "conversations" USING btree ("provider","external_thread_id") WHERE "conversations"."external_thread_id" is not null;--> statement-breakpoint
CREATE INDEX "conversations_active_sync_idx" ON "conversations" USING btree ("last_synced_at") WHERE "conversations"."status" = 'active' and "conversations"."external_thread_id" is not null;--> statement-breakpoint
CREATE INDEX "messages_conversation_sent_idx" ON "messages" USING btree ("conversation_id","sent_at");--> statement-breakpoint
CREATE INDEX "messages_sender_member_idx" ON "messages" USING btree ("sender_member_id") WHERE "messages"."sender_member_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "messages_conversation_external_uidx" ON "messages" USING btree ("conversation_id","external_message_id") WHERE "messages"."external_message_id" is not null;
