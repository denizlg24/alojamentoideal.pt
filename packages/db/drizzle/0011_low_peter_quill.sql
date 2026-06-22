CREATE TABLE "accommodation_item_details" (
	"order_item_id" text PRIMARY KEY NOT NULL,
	"adults" integer DEFAULT 0 NOT NULL,
	"check_in" date NOT NULL,
	"check_out" date NOT NULL,
	"children" integer DEFAULT 0 NOT NULL,
	"external_account_id" text NOT NULL,
	"guests" integer NOT NULL,
	"hostify_listing_id" text NOT NULL,
	"infants" integer DEFAULT 0 NOT NULL,
	"nights" integer NOT NULL,
	"pets" integer DEFAULT 0 NOT NULL,
	"property_timezone" text NOT NULL,
	"provider" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accommodation_quote_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"adults" integer NOT NULL,
	"check_in" date NOT NULL,
	"check_out" date NOT NULL,
	"children" integer DEFAULT 0 NOT NULL,
	"cleaning_fee_minor" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"currency" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"external_account_id" text NOT NULL,
	"fee_lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"guests" integer NOT NULL,
	"infants" integer DEFAULT 0 NOT NULL,
	"listing_external_id" text NOT NULL,
	"nightly_average_minor" bigint,
	"nights" integer NOT NULL,
	"pets" integer DEFAULT 0 NOT NULL,
	"provider" text NOT NULL,
	"provider_payload" jsonb,
	"subtotal_minor" bigint NOT NULL,
	"tax_minor" bigint DEFAULT 0 NOT NULL,
	"total_minor" bigint NOT NULL,
	"validation_status" text DEFAULT 'valid' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_idempotency_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_snapshot" jsonb,
	"scope" text NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "carts" (
	"id" text PRIMARY KEY NOT NULL,
	"cart_token" text NOT NULL,
	"converted_order_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"currency" text NOT NULL,
	"discount_minor" bigint DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"item_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"subtotal_minor" bigint DEFAULT 0 NOT NULL,
	"tax_minor" bigint DEFAULT 0 NOT NULL,
	"total_minor" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cart_items" (
	"id" text PRIMARY KEY NOT NULL,
	"cart_id" text NOT NULL,
	"client_mutation_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"position" integer NOT NULL,
	"quote_snapshot_id" text NOT NULL,
	"removed_at" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"type" text DEFAULT 'accommodation' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"amount_paid_minor" bigint DEFAULT 0 NOT NULL,
	"amount_refunded_minor" bigint DEFAULT 0 NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cart_id" text,
	"checkout_expires_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"currency" text NOT NULL,
	"discount_minor" bigint DEFAULT 0 NOT NULL,
	"failure_code" text,
	"failure_detail" text,
	"public_reference" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"subtotal_minor" bigint NOT NULL,
	"tax_minor" bigint DEFAULT 0 NOT NULL,
	"total_minor" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"billing_address" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"company_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"email" text NOT NULL,
	"is_company" boolean DEFAULT false NOT NULL,
	"name" text NOT NULL,
	"notes" text,
	"order_id" text NOT NULL,
	"phone_e164" text NOT NULL,
	"tax_number" text
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" text PRIMARY KEY NOT NULL,
	"catalog_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"currency" text NOT NULL,
	"discount_minor" bigint DEFAULT 0 NOT NULL,
	"image_url_snapshot" text,
	"order_id" text NOT NULL,
	"position" integer NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"source_cart_item_id" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"subtotal_minor" bigint NOT NULL,
	"tax_minor" bigint DEFAULT 0 NOT NULL,
	"title_snapshot" text NOT NULL,
	"total_minor" bigint NOT NULL,
	"type" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_item_charges" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"gross_minor" bigint NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"net_minor" bigint NOT NULL,
	"order_item_id" text NOT NULL,
	"position" integer NOT NULL,
	"provider_charge_id" text,
	"quantity" numeric(12, 2) NOT NULL,
	"raw_payload" jsonb,
	"tax_minor" bigint DEFAULT 0 NOT NULL,
	"tax_rate_basis_points" integer,
	"unit_net_minor" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accommodation_item_details" ADD CONSTRAINT "accommodation_item_details_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cart_id_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."carts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_quote_snapshot_id_accommodation_quote_snapshots_id_fk" FOREIGN KEY ("quote_snapshot_id") REFERENCES "public"."accommodation_quote_snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_cart_id_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."carts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_contacts" ADD CONSTRAINT "order_contacts_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_source_cart_item_id_cart_items_id_fk" FOREIGN KEY ("source_cart_item_id") REFERENCES "public"."cart_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item_charges" ADD CONSTRAINT "order_item_charges_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accommodation_item_details_listing_idx" ON "accommodation_item_details" USING btree ("provider","external_account_id","hostify_listing_id");--> statement-breakpoint
CREATE INDEX "accommodation_quote_snapshots_scope_dates_idx" ON "accommodation_quote_snapshots" USING btree ("provider","external_account_id","listing_external_id","check_in","check_out");--> statement-breakpoint
CREATE INDEX "accommodation_quote_snapshots_expires_at_idx" ON "accommodation_quote_snapshots" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "accommodation_quote_snapshots_validation_status_idx" ON "accommodation_quote_snapshots" USING btree ("validation_status");--> statement-breakpoint
CREATE UNIQUE INDEX "api_idempotency_keys_scope_key_uidx" ON "api_idempotency_keys" USING btree ("scope","key");--> statement-breakpoint
CREATE INDEX "api_idempotency_keys_expires_at_idx" ON "api_idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "carts_cart_token_uidx" ON "carts" USING btree ("cart_token");--> statement-breakpoint
CREATE INDEX "carts_status_expires_at_idx" ON "carts" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "cart_items_cart_status_idx" ON "cart_items" USING btree ("cart_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "cart_items_cart_position_uidx" ON "cart_items" USING btree ("cart_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "cart_items_client_mutation_uidx" ON "cart_items" USING btree ("cart_id","client_mutation_id") WHERE "cart_items"."client_mutation_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "orders_public_reference_uidx" ON "orders" USING btree ("public_reference");--> statement-breakpoint
CREATE INDEX "orders_cart_id_idx" ON "orders" USING btree ("cart_id");--> statement-breakpoint
CREATE INDEX "orders_status_created_at_idx" ON "orders" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "order_contacts_order_id_uidx" ON "order_contacts" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_contacts_email_idx" ON "order_contacts" USING btree ("email");--> statement-breakpoint
CREATE INDEX "order_items_order_id_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "order_items_order_position_uidx" ON "order_items" USING btree ("order_id","position");--> statement-breakpoint
CREATE INDEX "order_item_charges_order_item_id_idx" ON "order_item_charges" USING btree ("order_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "order_item_charges_item_position_uidx" ON "order_item_charges" USING btree ("order_item_id","position");