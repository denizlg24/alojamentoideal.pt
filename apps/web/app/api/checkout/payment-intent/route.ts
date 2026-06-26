import { parseCreatePaymentIntentBody } from "@workspace/core/commerce";
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
 * Creates (or reuses) the Stripe PaymentIntent backing an existing draft order
 * so the client can mount Elements. Used by the resume path, where the order
 * already exists; the happy path goes through prepare-payment, which creates
 * the draft order and the intent in one round trip. The payable amount is
 * re-read from the persisted order server-side; the client never supplies it.
 */
export const POST = withApiRoute(
	{ name: "checkout.payment_intent", rateLimit: { bucket: "checkout.write" } },
	async (request: Request): Promise<Response> => {
		const parsed = parseCreatePaymentIntentBody(await readJson(request));
		if (!parsed.success) {
			return validationResponse(parsed, "Invalid payment request");
		}

		const owner = await resolveCartOwner(request);

		try {
			const service = commerceService();
			// With an order id, re-read that order directly; without one, resolve the
			// payable order the cart was converted into (converted-cart resume).
			const order = parsed.data.orderId
				? await service.getPayableOrder(parsed.data.orderId, owner)
				: await service.getPayableOrderForCart(parsed.data.cartId, owner);

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
