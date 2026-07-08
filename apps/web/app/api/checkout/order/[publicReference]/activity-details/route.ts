import { parseUpdateDraftOrderActivityDetailsBody } from "@workspace/core/commerce";
import {
	commerceErrorResponse,
	commerceService,
	readJson,
	resolveCartOwner,
	validationResponse,
} from "@/lib/api/commerce";
import { withApiRoute } from "@/lib/api/route";

interface OrderActivityDetailsRouteContext {
	params: Promise<{ publicReference: string }>;
}

/**
 * Owner-scoped update for Bokun activity answers on a draft order. Checkout
 * uses this when a guest edits details after the PaymentIntent is already ready,
 * but before Stripe confirmation places the provider hold.
 */
export const PUT = withApiRoute<OrderActivityDetailsRouteContext>(
	{
		name: "checkout.order_activity_details_update",
		rateLimit: { bucket: "checkout.write" },
	},
	async (request: Request, context): Promise<Response> => {
		const { publicReference } = await context.params;
		const parsed = parseUpdateDraftOrderActivityDetailsBody(
			await readJson(request),
		);
		if (!parsed.success) {
			return validationResponse(parsed, "Invalid activity details");
		}

		const owner = await resolveCartOwner(request);

		try {
			await (await commerceService()).updateDraftOrderActivityDetails(
				publicReference,
				owner,
				parsed.data.activityDetails,
			);
			return new Response(null, { status: 204 });
		} catch (error) {
			const response = commerceErrorResponse(error);
			if (response) {
				return response;
			}
			throw error;
		}
	},
);
