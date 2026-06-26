import { parseCreatePaymentIntentBody } from "@workspace/core/commerce";
import { holdReservationForPayment } from "@/lib/api/checkout-payment";
import {
	commerceErrorResponse,
	commerceService,
	readJson,
	resolveCartOwner,
	validationResponse,
} from "@/lib/api/commerce";
import { withApiRoute } from "@/lib/api/route";

/**
 * Places the slow provider reservation hold immediately before the client asks
 * Stripe to confirm payment. This keeps the payment form fast while preserving
 * the no-hold/no-charge safety gate for the normal checkout path.
 */
export const maxDuration = 60;

export const POST = withApiRoute(
	{
		name: "checkout.hold_reservation",
		rateLimit: { bucket: "checkout.write" },
	},
	async (request: Request): Promise<Response> => {
		const parsed = parseCreatePaymentIntentBody(await readJson(request));
		if (!parsed.success) {
			return validationResponse(parsed, "Invalid reservation hold request");
		}

		const owner = await resolveCartOwner(request);

		try {
			const service = commerceService();
			const order = parsed.data.orderId
				? await service.getPayableOrder(parsed.data.orderId, owner)
				: await service.getPayableOrderForCart(parsed.data.cartId, owner);

			return Response.json(
				await holdReservationForPayment(service, parsed.data.cartId, order),
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
