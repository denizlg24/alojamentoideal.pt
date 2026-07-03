import { z } from "zod";
import { readJson } from "@/lib/api/commerce";
import {
	invoicingErrorResponse,
	invoicingService,
	rejectUnlessInvoicingAdmin,
} from "@/lib/api/invoicing";
import { withApiRoute } from "@/lib/api/route";

interface AdminOrderItemInvoiceRouteContext {
	params: Promise<{ itemId: string; reference: string }>;
}

const createInvoiceSchema = z.object({
	invoiceType: z.enum(["FR", "FT"]).optional(),
});

/**
 * Admin-only: issue the Hostkit invoice for one order item (draft -> lines
 * from the order's own charge rows -> close). Double-gated: admin role plus
 * HOSTKIT_INVOICING_ENABLED. Deliberately not wired into any UI or payment
 * hook yet; issuance is an explicit operator action.
 */
export const POST = withApiRoute<AdminOrderItemInvoiceRouteContext>(
	{ name: "admin.orders.invoices.create", rateLimit: { bucket: "mutation" } },
	async (request: Request, context): Promise<Response> => {
		const rejection = await rejectUnlessInvoicingAdmin(request, {
			mutation: true,
		});
		if (rejection) {
			return rejection;
		}

		const { itemId, reference } = await context.params;
		const body = await readJson(request);
		const parsed = createInvoiceSchema.safeParse(body ?? {});
		if (!parsed.success) {
			return Response.json(
				{ code: "invalid_request", error: "Invalid invoice options." },
				{ status: 400 },
			);
		}

		try {
			const invoice = await invoicingService().createInvoiceForOrderItem({
				invoiceType: parsed.data.invoiceType,
				orderItemId: itemId,
				orderReference: reference,
			});
			return Response.json({ data: { invoice }, success: true });
		} catch (error) {
			const handled = invoicingErrorResponse(error);
			if (handled) {
				return handled;
			}
			throw error;
		}
	},
);
