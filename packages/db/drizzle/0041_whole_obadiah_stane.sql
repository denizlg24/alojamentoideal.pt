ALTER TABLE "order_invoices" DROP CONSTRAINT "order_invoices_status_check";--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "invoice_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "invoice_request_fulfilled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "order_invoices" ADD COLUMN "replacement_for_invoice_id" text;--> statement-breakpoint
ALTER TABLE "order_invoices" ADD COLUMN "invoice_type" text;--> statement-breakpoint
ALTER TABLE "order_invoices" ADD COLUMN "customer_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "order_invoices" ADD COLUMN "line_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "order_invoices" ADD CONSTRAINT "order_invoices_replacement_for_invoice_id_order_invoices_id_fk" FOREIGN KEY ("replacement_for_invoice_id") REFERENCES "public"."order_invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_invoices_replacement_invoice_idx" ON "order_invoices" USING btree ("replacement_for_invoice_id");--> statement-breakpoint
ALTER TABLE "order_invoices" ADD CONSTRAINT "order_invoices_status_check" CHECK ("order_invoices"."status" in ('credited', 'draft', 'failed', 'issued'));