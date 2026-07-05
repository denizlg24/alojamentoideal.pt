import { parseDraftOrderBody } from "@workspace/core/commerce";
import { buildPaymentIntentResponse } from "@/lib/api/checkout-payment";
import {
	commerceErrorResponse,
	commerceService,
	readJson,
	resolveCartOwner,
	validationResponse,
} from "@/lib/api/commerce";
import { withApiRoute } from "@/lib/api/route";

/**
 * Happy-path checkout step in one round trip: freeze the cart into a draft
 * order (revalidating the quote), then create the Stripe PaymentIntent. The
 * slow provider reservation hold intentionally happens later, immediately before
 * Stripe confirmation, so the payment form can render without waiting on
 * Hostify. Both underlying steps are idempotent (`draft:<cartId>`,
 * `pi:<orderId>`), so a retry replays safely. The standalone payment-intent
 * route still backs the resume path, where the draft order already exists and
 * only its intent needs (re)creating.
 */
export const maxDuration = 60;

export const POST = withApiRoute(
	{ name: "checkout.prepare_payment", rateLimit: { bucket: "checkout.write" } },
	async (request: Request): Promise<Response> => {
		const parsed = parseDraftOrderBody(await readJson(request));
		if (!parsed.success) {
			return validationResponse(parsed, "Invalid draft order request");
		}

		const ownerPromise = resolveCartOwner(request);
		const servicePromise = commerceService();

		try {
			const [owner, service] = await Promise.all([
				ownerPromise,
				servicePromise,
			]);
			const draft = await service.createDraftOrder(parsed.data, owner);
			const order = await service.getPayableOrder(draft.orderId, owner);

			return Response.json(
				await buildPaymentIntentResponse(service, parsed.data.cartId, order),
			);
		} catch (error) {
			const response = commerceErrorResponse(error);
			if (response) {
				return response;
			}
			throw error;
		}
	},
);
