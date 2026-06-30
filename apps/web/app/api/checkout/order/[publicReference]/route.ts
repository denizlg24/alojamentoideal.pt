import {
	type CheckoutPaymentStatus,
	mapStripePaymentStatus,
	type OrderStatusResponse,
} from "@workspace/core/commerce";
import {
	createStripeClientFromEnv,
	retrievePaymentIntentSnapshot,
	StripeConfigurationError,
} from "@workspace/core/integrations/stripe";
import {
	commerceErrorResponse,
	commerceService,
	resolveCartOwner,
} from "@/lib/api/commerce";
import { withApiRoute } from "@/lib/api/route";

interface OrderStatusRouteContext {
	params: Promise<{ publicReference: string }>;
}

/**
 * Server-verified order/payment status for the completion page. Payment status
 * is resolved live from Stripe via the order's stored PaymentIntent id, never
 * derived from client-reported `paymentIntent.status`. Booking status reflects
 * the persisted order lifecycle, which only advances through backend workflow.
 */
export const GET = withApiRoute<OrderStatusRouteContext>(
	{ name: "checkout.order_status", rateLimit: { bucket: "cart.read" } },
	async (request: Request, context): Promise<Response> => {
		const { publicReference } = await context.params;
		const owner = await resolveCartOwner(request);

		try {
			const record = await commerceService().readOrderStatus(
				publicReference,
				owner,
			);

			// Fallback when no intent exists (e.g. zero-total) or Stripe is down:
			// trust persisted booking facts rather than guessing.
			let paymentStatus: CheckoutPaymentStatus =
				record.bookingStatus === "confirmed" || record.amountPaidMinor > 0
					? "succeeded"
					: "unknown";

			if (record.stripePaymentIntentId) {
				try {
					const stripe = createStripeClientFromEnv();
					const snapshot = await retrievePaymentIntentSnapshot(
						stripe,
						record.stripePaymentIntentId,
					);
					paymentStatus = mapStripePaymentStatus(snapshot.status);
				} catch (error) {
					if (!(error instanceof StripeConfigurationError)) {
						throw error;
					}
				}
			}

			const body: OrderStatusResponse = {
				amountMinor: record.totalMinor,
				amountPaidMinor: record.amountPaidMinor,
				bookingStatus: record.bookingStatus,
				conversationAvailability: record.conversationAvailability,
				currency: record.currency,
				guestProgress: record.guestProgress,
				orderId: record.orderId,
				orderUrl: `/order/${encodeURIComponent(record.publicReference)}`,
				paymentStatus,
				provisioningSubState: record.provisioningSubState,
				publicReference: record.publicReference,
			};
			return Response.json(body);
		} catch (error) {
			const response = commerceErrorResponse(error);
			if (response) {
				return response;
			}
			throw error;
		}
	},
);
