CREATE TABLE "order_invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"order_item_id" text NOT NULL,
	"kind" text DEFAULT 'invoice' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"ref_invoice_id" text,
	"hostkit_invoice_id" text,
	"hostkit_series" text,
	"invoicing_nif" text,
	"reservation_code" text,
	"document_url" text,
	"currency" text NOT NULL,
	"total_minor" bigint NOT NULL,
	"last_error_message" text,
	"issued_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_invoices_kind_check" CHECK ("order_invoices"."kind" in ('credit_note', 'invoice')),
	CONSTRAINT "order_invoices_status_check" CHECK ("order_invoices"."status" in ('draft', 'failed', 'issued'))
);
--> statement-breakpoint
ALTER TABLE "order_invoices" ADD CONSTRAINT "order_invoices_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_invoices" ADD CONSTRAINT "order_invoices_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_invoices" ADD CONSTRAINT "order_invoices_ref_invoice_id_order_invoices_id_fk" FOREIGN KEY ("ref_invoice_id") REFERENCES "public"."order_invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_invoices" ADD CONSTRAINT "order_invoices_order_item_order_fk" FOREIGN KEY ("order_item_id","order_id") REFERENCES "public"."order_items"("id","order_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_invoices_order_idx" ON "order_invoices" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_invoices_order_item_idx" ON "order_invoices" USING btree ("order_item_id");--> statement-breakpoint
CREATE INDEX "order_invoices_ref_invoice_idx" ON "order_invoices" USING btree ("ref_invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "order_invoices_active_invoice_uidx" ON "order_invoices" USING btree ("order_item_id") WHERE "order_invoices"."kind" = 'invoice' and "order_invoices"."status" in ('draft', 'issued');