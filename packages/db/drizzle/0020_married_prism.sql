CREATE TABLE "order_members" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"role" text NOT NULL,
	"email" text NOT NULL,
	"user_id" text,
	"access_token_hash" text NOT NULL,
	"status" text DEFAULT 'invited' NOT NULL,
	"invited_by_member_id" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	CONSTRAINT "order_members_role_check" CHECK ("order_members"."role" in ('owner', 'member')),
	CONSTRAINT "order_members_status_check" CHECK ("order_members"."status" in ('invited', 'active', 'revoked'))
);
--> statement-breakpoint
ALTER TABLE "order_members" ADD CONSTRAINT "order_members_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_members" ADD CONSTRAINT "order_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_members" ADD CONSTRAINT "order_members_invited_by_member_id_order_members_id_fk" FOREIGN KEY ("invited_by_member_id") REFERENCES "public"."order_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "order_members_access_token_hash_uidx" ON "order_members" USING btree ("access_token_hash");--> statement-breakpoint
CREATE INDEX "order_members_order_id_idx" ON "order_members" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_members_user_id_idx" ON "order_members" USING btree ("user_id") WHERE "order_members"."user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "order_members_owner_uidx" ON "order_members" USING btree ("order_id") WHERE "order_members"."role" = 'owner';