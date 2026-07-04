import { z } from "zod";
import { readJson } from "@/lib/api/admin-route";
import { invoicingService, withInvoicingAdmin } from "@/lib/api/invoicing";

interface AdminOrderItemInvoiceRouteContext {
	params: Promise<{ itemId: string; reference: string }>;
}

const createInvoiceSchema = z.object({
	invoiceType: z.enum(["FR", "FT"]).optional(),
});

/**
 * Admin-only: issue the Hostkit invoice for one order item (draft -> lines
 * from the order's own charge rows -> close). Double-gated: admin role plus
 * HOSTKIT_INVOICING_ENABLED. Issuance is an explicit operator action, never
 * a payment hook.
 */
export const POST = withInvoicingAdmin<AdminOrderItemInvoiceRouteContext>(
	{ name: "admin.orders.invoices.create", rateLimit: { bucket: "mutation" } },
	async (request: Request, context): Promise<Response> => {
		const { itemId, reference } = await context.params;
		const body = await readJson(request);
		const parsed = createInvoiceSchema.safeParse(body ?? {});

		if (!parsed.success) {
			return Response.json(
				{ code: "invalid_request", error: "Invalid invoice options." },
				{ status: 400 },
			);
		}

		const invoice = await invoicingService().createInvoiceForOrderItem({
			invoiceType: parsed.data.invoiceType,
			orderItemId: itemId,
			orderReference: reference,
		});
		return Response.json({ data: { invoice }, success: true });
	},
);
