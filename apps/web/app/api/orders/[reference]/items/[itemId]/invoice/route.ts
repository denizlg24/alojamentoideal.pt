import { commerceErrorResponse } from "@/lib/api/commerce";
import { withApiRoute } from "@/lib/api/route";
import {
	fetchOrderActivityInvoice,
	resolveOrderActivityItemForRequest,
} from "@/lib/order/activity";

interface OrderItemInvoiceRouteContext {
	params: Promise<{ itemId: string; reference: string }>;
}

/**
 * Streams the Bokun booking summary PDF (the guest-facing activity invoice)
 * for one order item. Owner-only.
 */
export const GET = withApiRoute<OrderItemInvoiceRouteContext>(
	{ name: "orders.activity_invoice", rateLimit: { bucket: "cart.read" } },
	async (request: Request, context): Promise<Response> => {
		const { itemId, reference } = await context.params;
		try {
			const resolved = await resolveOrderActivityItemForRequest(
				request,
				reference,
				itemId,
			);
			if (!resolved.ok) {
				return resolved.response;
			}
			const invoice = await fetchOrderActivityInvoice(resolved.item);
			if (!invoice) {
				return Response.json(
					{ code: "not_found", error: "Invoice is not available yet." },
					{ status: 404 },
				);
			}
			return new Response(Buffer.from(invoice, "base64"), {
				headers: {
					"Cache-Control": "private, no-store",
					"Content-Disposition": `attachment; filename="invoice-${reference}.pdf"`,
					"Content-Type": "application/pdf",
				},
			});
		} catch (error) {
			const handled = commerceErrorResponse(error);
			if (handled) {
				return handled;
			}
			throw error;
		}
	},
);
