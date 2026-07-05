import { parseOrderContactBody } from "@workspace/core/commerce";
import {
	commerceErrorResponse,
	commerceService,
	readJson,
	resolveCartOwner,
	validationResponse,
} from "@/lib/api/commerce";
import { withApiRoute } from "@/lib/api/route";

interface OrderContactRouteContext {
	params: Promise<{ publicReference: string }>;
}

/**
 * Owner-scoped contact for a draft order. `GET` repaints the checkout contact
 * form after a reload (contact is never kept in browser storage); `PUT` lets a
 * guest fix a mistake after submitting. Both authorize via the order's linked
 * user or the anonymous `ai_cart` token, and updates require a `draft` order.
 */
export const GET = withApiRoute<OrderContactRouteContext>(
	{ name: "checkout.order_contact_read", rateLimit: { bucket: "cart.read" } },
	async (request: Request, context): Promise<Response> => {
		const { publicReference } = await context.params;
		const owner = await resolveCartOwner(request);

		try {
			const contact = await (await commerceService()).getOrderContact(
				publicReference,
				owner,
			);
			return Response.json({ contact });
		} catch (error) {
			const response = commerceErrorResponse(error);
			if (response) {
				return response;
			}
			throw error;
		}
	},
);

export const PUT = withApiRoute<OrderContactRouteContext>(
	{
		name: "checkout.order_contact_update",
		rateLimit: { bucket: "checkout.write" },
	},
	async (request: Request, context): Promise<Response> => {
		const { publicReference } = await context.params;
		const parsed = parseOrderContactBody(await readJson(request));
		if (!parsed.success) {
			return validationResponse(parsed, "Invalid contact details");
		}

		const owner = await resolveCartOwner(request);

		try {
			await (await commerceService()).updateDraftOrderContact(
				publicReference,
				owner,
				parsed.data,
			);
			return Response.json({ contact: parsed.data });
		} catch (error) {
			const response = commerceErrorResponse(error);
			if (response) {
				return response;
			}
			throw error;
		}
	},
);
