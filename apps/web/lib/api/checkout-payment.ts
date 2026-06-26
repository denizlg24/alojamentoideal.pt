import {
	CommerceError,
	type CommerceService,
	type PayableOrder,
	type PaymentIntentResponse,
} from "@workspace/core/commerce";
import {
	createOrUpdatePaymentIntent,
	createStripeClientFromEnv,
	StripeConfigurationError,
} from "@workspace/core/integrations/stripe";

/**
 * Turns a resolved payable order into the response the checkout client mounts
 * Elements against: a zero-total short circuit, or the reserve-first hold
 * followed by a Stripe PaymentIntent. Shared by the standalone payment-intent
 * route (resume path) and the combined prepare-payment route (happy path) so
 * the hold/charge ordering stays defined in exactly one place.
 */
export async function buildPaymentIntentResponse(
	service: CommerceService,
	cartId: string,
	order: PayableOrder,
): Promise<PaymentIntentResponse> {
	// Defense in depth: the order must belong to the cart the client claims.
	if (order.cartId && order.cartId !== cartId) {
		throw new CommerceError("order_not_found", "Order not found.", 404);
	}

	if (order.totalMinor <= 0) {
		return {
			amountMinor: 0,
			checkoutExpiresAt: order.checkoutExpiresAt,
			currency: order.currency,
			kind: "zero_total",
			orderId: order.orderId,
			publicReference: order.publicReference,
		};
	}

	let stripe: ReturnType<typeof createStripeClientFromEnv>;
	try {
		stripe = createStripeClientFromEnv();
	} catch (error) {
		if (error instanceof StripeConfigurationError) {
			throw new CommerceError(
				"payment_unavailable",
				"Payments are not available right now.",
				503,
			);
		}
		throw error;
	}

	// Reserve-first gate: place the Hostify hold before charging. No hold ->
	// no PaymentIntent -> no charge. Availability is re-checked against the
	// provider here, so a quote->book race fails before money is taken.
	const hold = await service.holdOrderReservations(order.orderId);
	if (hold.outcome === "unavailable") {
		throw new CommerceError("reservation_unavailable", hold.message, 409);
	}
	if (hold.outcome === "transient_error") {
		throw new CommerceError(
			"payment_unavailable",
			"We could not hold this stay just now. Please try again.",
			503,
		);
	}
	if (hold.outcome === "not_holdable") {
		throw new CommerceError(
			"order_not_payable",
			"This order can no longer be paid.",
			409,
		);
	}

	const snapshot = await createOrUpdatePaymentIntent(stripe, {
		amountMinor: order.totalMinor,
		cartId,
		currency: order.currency,
		environment: process.env.NODE_ENV ?? "development",
		existingPaymentIntentId: order.stripePaymentIntentId,
		// Deterministic per order: one intent per draft order, retry-safe.
		idempotencyKey: `pi:${order.orderId}`,
		orderId: order.orderId,
		publicReference: order.publicReference,
	});

	if (!order.stripePaymentIntentId) {
		await service.attachPaymentIntentId(order.orderId, snapshot.id);
	}

	return {
		amountMinor: snapshot.amountMinor,
		checkoutExpiresAt: order.checkoutExpiresAt,
		clientSecret: snapshot.clientSecret,
		currency: snapshot.currency,
		kind: "payment_intent",
		orderId: order.orderId,
		paymentIntentId: snapshot.id,
		publicReference: order.publicReference,
	};
}
