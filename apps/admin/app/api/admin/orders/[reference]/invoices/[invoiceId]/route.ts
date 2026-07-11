import { invoicingService, withInvoicingAdmin } from "@/lib/api/invoicing";

interface AdminInvoiceRouteContext {
	params: Promise<{ invoiceId: string; reference: string }>;
}

export const DELETE = withInvoicingAdmin<AdminInvoiceRouteContext>(
	{
		name: "admin.orders.invoices.delete",
		rateLimit: { bucket: "mutation" },
	},
	async (_request, context): Promise<Response> => {
		const { invoiceId, reference } = await context.params;
		await invoicingService().deleteInvoice({
			invoiceId,
			orderReference: reference,
		});
		return Response.json({ success: true });
	},
);
