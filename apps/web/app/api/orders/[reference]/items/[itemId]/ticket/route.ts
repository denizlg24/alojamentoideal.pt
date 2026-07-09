import { commerceErrorResponse } from "@/lib/api/commerce";
import { withApiRoute } from "@/lib/api/route";
import {
	fetchOrderActivityTicket,
	resolveOrderActivityItemForRequest,
} from "@/lib/order/activity";

interface OrderItemTicketRouteContext {
	params: Promise<{ itemId: string; reference: string }>;
}

/** Streams the Bokun activity ticket PDF for one order item. Owner-only. */
export const GET = withApiRoute<OrderItemTicketRouteContext>(
	{ name: "orders.activity_ticket", rateLimit: { bucket: "cart.read" } },
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
			const ticket = await fetchOrderActivityTicket(resolved.item);
			if (!ticket) {
				return Response.json(
					{ code: "not_found", error: "Ticket is not available yet." },
					{ status: 404 },
				);
			}
			return new Response(Buffer.from(ticket, "base64"), {
				headers: {
					"Cache-Control": "private, no-store",
					"Content-Disposition": `attachment; filename="ticket-${reference}.pdf"`,
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
