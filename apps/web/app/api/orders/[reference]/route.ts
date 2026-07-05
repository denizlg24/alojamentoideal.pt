import {
	commerceErrorResponse,
	commerceService,
	resolveOrderAccessContext,
} from "@/lib/api/commerce";
import { withApiRoute } from "@/lib/api/route";

interface OrderDetailRouteContext {
	params: Promise<{ reference: string }>;
}

/**
 * The durable order-hub read model. Authorizes through `resolveOrderAccess` (the
 * redeemed member cookie, or the original cart/user owner grant), then returns a
 * role-filtered aggregate: the owner sees pricing, contact, and the member
 * roster; an invited member sees only the non-sensitive booking shape. Unknown
 * or unauthorized references report 404 so the order stays unenumerable.
 */
export const GET = withApiRoute<OrderDetailRouteContext>(
	{ name: "orders.detail_read", rateLimit: { bucket: "cart.read" } },
	async (request: Request, context): Promise<Response> => {
		const { reference } = await context.params;
		const accessContext = await resolveOrderAccessContext(request, reference);

		try {
			const service = await commerceService();
			const access = await service.resolveOrderAccess(reference, accessContext);
			const detail = await service.readOrderDetail(access);
			return Response.json(detail);
		} catch (error) {
			const handled = commerceErrorResponse(error);
			if (handled) {
				return handled;
			}
			throw error;
		}
	},
);
