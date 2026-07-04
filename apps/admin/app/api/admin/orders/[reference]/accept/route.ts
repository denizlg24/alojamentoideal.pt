import { withAdminRoute } from "@/lib/api/admin-route";
import {
	commerceErrorResponse,
	commerceService,
	loadAdminOrder,
} from "@/lib/api/commerce";

interface AdminOrderAcceptRouteContext {
	params: Promise<{ reference: string }>;
}

/**
 * Manually drives the confirm leg of the reservation saga for a paid order
 * stuck in `pending` (e.g. Hostify left the hold pending, or retries ran
 * out). Idempotent: an already-confirmed order is a no-op.
 */
export const POST = withAdminRoute<AdminOrderAcceptRouteContext>(
	{ name: "admin.orders.accept", rateLimit: { bucket: "mutation" } },
	async (_request: Request, context): Promise<Response> => {
		const { reference } = await context.params;
		const row = await loadAdminOrder(reference);
		if (!row) {
			return Response.json({ error: "Order not found" }, { status: 404 });
		}

		try {
			const result = await commerceService().confirmOrderReservations(row.id);
			return Response.json({ data: result, success: true });
		} catch (error) {
			const handled = commerceErrorResponse(error);
			if (handled) {
				return handled;
			}
			throw error;
		}
	},
);
