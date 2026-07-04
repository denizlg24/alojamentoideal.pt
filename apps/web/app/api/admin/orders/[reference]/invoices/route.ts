import { invoicingService, withInvoicingAdmin } from "@/lib/api/invoicing";

interface AdminOrderInvoicesRouteContext {
	params: Promise<{ reference: string }>;
}

/**
 * Admin-only: fiscal documents recorded for an order (local rows, no
 * provider call). Not linked from any UI yet — M7 dashboard territory.
 */
export const GET = withInvoicingAdmin<AdminOrderInvoicesRouteContext>(
	{
		mutation: false,
		name: "admin.orders.invoices.list",
		rateLimit: { bucket: "default" },
	},
	async (_: Request, context): Promise<Response> => {
		const { reference } = await context.params;
		const invoices = await invoicingService().listOrderInvoices(reference);
		return Response.json({ data: { invoices }, success: true });
	},
);
