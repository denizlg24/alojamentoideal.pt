import {
	invoicingErrorResponse,
	invoicingService,
	rejectUnlessInvoicingAdmin,
} from "@/lib/api/invoicing";
import { withApiRoute } from "@/lib/api/route";

interface AdminCreditNoteRouteContext {
	params: Promise<{ invoiceId: string; reference: string }>;
}

/**
 * Admin-only: issue a Hostkit credit note voiding a previously issued
 * invoice. Same double gate as invoice creation; not wired into any UI.
 */
export const POST = withApiRoute<AdminCreditNoteRouteContext>(
	{
		name: "admin.orders.invoices.credit_note",
		rateLimit: { bucket: "mutation" },
	},
	async (request: Request, context): Promise<Response> => {
		const rejection = await rejectUnlessInvoicingAdmin(request, {
			mutation: true,
		});
		if (rejection) {
			return rejection;
		}

		const { invoiceId, reference } = await context.params;
		try {
			const creditNote = await invoicingService().createCreditNote({
				invoiceId,
				orderReference: reference,
			});
			return Response.json({ data: { creditNote }, success: true });
		} catch (error) {
			const handled = invoicingErrorResponse(error);
			if (handled) {
				return handled;
			}
			throw error;
		}
	},
);
