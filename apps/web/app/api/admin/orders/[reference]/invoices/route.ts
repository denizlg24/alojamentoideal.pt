import {
	invoicingErrorResponse,
	invoicingService,
	rejectUnlessInvoicingAdmin,
} from "@/lib/api/invoicing";
import { withApiRoute } from "@/lib/api/route";

interface AdminOrderInvoicesRouteContext {
	params: Promise<{ reference: string }>;
}

/**
 * Admin-only: fiscal documents recorded for an order (local rows, no
 * provider call). Not linked from any UI yet — M7 dashboard territory.
 */
export const GET = withApiRoute<AdminOrderInvoicesRouteContext>(
	{ name: "admin.orders.invoices.list", rateLimit: { bucket: "default" } },
	async (request: Request, context): Promise<Response> => {
		const rejection = await rejectUnlessInvoicingAdmin(request, {
			mutation: false,
		});
		if (rejection) {
			return rejection;
		}

		const { reference } = await context.params;
		try {
			const invoices = await invoicingService().listOrderInvoices(reference);
			return Response.json({ data: { invoices }, success: true });
		} catch (error) {
			const handled = invoicingErrorResponse(error);
			if (handled) {
				return handled;
			}
			throw error;
		}
	},
);
