import { invoicingService, withInvoicingAdmin } from "@/lib/api/invoicing";

interface AdminOrderItemInvoiceDraftRouteContext {
	params: Promise<{ itemId: string; reference: string }>;
}

/**
 * Admin-only: the prefilled, fully editable invoice draft for one order item.
 * Read-only — no Hostkit call, no local row — so the operator can open the
 * invoicing form even while issuance itself is gated off.
 */
export const GET = withInvoicingAdmin<AdminOrderItemInvoiceDraftRouteContext>(
	{
		mutation: false,
		name: "admin.orders.invoices.draft",
		rateLimit: { bucket: "default" },
	},
	async (_: Request, context): Promise<Response> => {
		const { itemId, reference } = await context.params;
		const draft = await invoicingService().buildOrderItemInvoiceDraft({
			orderItemId: itemId,
			orderReference: reference,
		});
		return Response.json({ data: { draft }, success: true });
	},
);
