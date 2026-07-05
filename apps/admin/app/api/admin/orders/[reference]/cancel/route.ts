import { withAdminRoute } from "@/lib/api/admin-route";
import {
	commerceErrorResponse,
	commerceService,
	loadAdminOrder,
} from "@/lib/api/commerce";

interface AdminOrderCancelRouteContext {
	params: Promise<{ reference: string }>;
}

const ADMIN_CANCEL_REASON = "admin_cancelled";

/**
 * Manually cancels an order. A charged order goes through `compensateOrder`
 * (full refund, order -> cancelled, holds released); an unpaid one through
 * `cancelOrderReservations` (holds released, order -> failed). Both legs are
 * idempotent re-runs of the saga's own compensation paths.
 */
export const POST = withAdminRoute<AdminOrderCancelRouteContext>(
	{ name: "admin.orders.cancel", rateLimit: { bucket: "mutation" } },
	async (_request: Request, context): Promise<Response> => {
		const { reference } = await context.params;
		const row = await loadAdminOrder(reference);
		if (!row) {
			return Response.json({ error: "Order not found" }, { status: 404 });
		}

		try {
			const service = await commerceService();
			const result =
				row.amountPaidMinor > 0
					? await service.compensateOrder(row.id, ADMIN_CANCEL_REASON)
					: await service.cancelOrderReservations(row.id, ADMIN_CANCEL_REASON);
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
