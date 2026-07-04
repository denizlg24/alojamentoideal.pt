import { invoicingService, withInvoicingAdmin } from "@/lib/api/invoicing";

interface AdminCreditNoteRouteContext {
	params: Promise<{ invoiceId: string; reference: string }>;
}

/**
 * Admin-only: issue a Hostkit credit note voiding a previously issued
 * invoice. Same double gate as invoice creation.
 */
export const POST = withInvoicingAdmin<AdminCreditNoteRouteContext>(
	{
		name: "admin.orders.invoices.credit_note",
		rateLimit: { bucket: "mutation" },
	},
	async (_: Request, context): Promise<Response> => {
		const { invoiceId, reference } = await context.params;

		const creditNote = await invoicingService().createCreditNote({
			invoiceId,
			orderReference: reference,
		});

		return Response.json({ data: { creditNote }, success: true });
	},
);
