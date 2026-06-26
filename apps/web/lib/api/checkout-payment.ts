import {
	CommerceError,
	type CommerceService,
	type HoldReservationResponse,
	type PayableOrder,
	type PaymentIntentResponse,
} from "@workspace/core/commerce";
import {
	createOrUpdatePaymentIntent,
	createStripeClientFromEnv,
	StripeConfigurationError,
} from "@workspace/core/integrations/stripe";
import { logger } from "@workspace/core/observability";

const SLOW_PAYMENT_RESPONSE_LOG_THRESHOLD_MS = 2_000;
const SLOW_RESERVATION_HOLD_LOG_THRESHOLD_MS = 2_000;

function elapsedSince(startedAt: number): number {
	return Math.round(performance.now() - startedAt);
}

function assertOrderBelongsToCart(order: PayableOrder, cartId: string): void {
	// Defense in depth: the order must belong to the cart the client claims. A
	// missing link is rejected too, so a payable order can never be paired with
	// an arbitrary cart id.
	if (order.cartId !== cartId) {
		throw new CommerceError("order_not_found", "Order not found.", 404);
	}
}

/**
 * Places the provider hold immediately before confirming payment. No successful
 * hold -> no Stripe confirmation attempt -> no normal charge.
 */
export async function holdReservationForPayment(
	service: CommerceService,
	cartId: string,
	order: PayableOrder,
): Promise<HoldReservationResponse> {
	assertOrderBelongsToCart(order, cartId);

	const startedAt = performance.now();
	const hold = await service.holdOrderReservations(order.orderId);
	const holdMs = elapsedSince(startedAt);

	if (holdMs >= SLOW_RESERVATION_HOLD_LOG_THRESHOLD_MS) {
		logger.info("checkout reservation hold prepared", {
			cartId,
			holdMs,
			orderId: order.orderId,
			publicReference: order.publicReference,
		});
	}

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

	return {
		checkoutExpiresAt: order.checkoutExpiresAt,
		orderId: order.orderId,
		publicReference: order.publicReference,
		status: "held",
	};
}

/**
 * Turns a resolved payable order into the response the checkout client mounts
 * Elements against: a zero-total short circuit, or a Stripe PaymentIntent.
 * Shared by the standalone payment-intent route (resume path) and the combined
 * prepare-payment route (happy path). Paid orders place the slow provider hold
 * later, immediately before `stripe.confirmPayment`, so the payment form can
 * render without waiting on Hostify.
 */
export async function buildPaymentIntentResponse(
	service: CommerceService,
	cartId: string,
	order: PayableOrder,
): Promise<PaymentIntentResponse> {
	const startedAt = performance.now();
	assertOrderBelongsToCart(order, cartId);

	if (order.totalMinor <= 0) {
		await holdReservationForPayment(service, cartId, order);
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

	const stripeStartedAt = performance.now();
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
	const stripeMs = elapsedSince(stripeStartedAt);

	let attachPaymentIntentMs = 0;
	if (!order.stripePaymentIntentId) {
		const attachStartedAt = performance.now();
		await service.attachPaymentIntentId(order.orderId, snapshot.id);
		attachPaymentIntentMs = elapsedSince(attachStartedAt);
	}

	const totalMs = elapsedSince(startedAt);
	if (totalMs >= SLOW_PAYMENT_RESPONSE_LOG_THRESHOLD_MS) {
		logger.info("checkout payment response prepared", {
			amountMinor: snapshot.amountMinor,
			attachPaymentIntentMs,
			cartId,
			currency: snapshot.currency,
			orderId: order.orderId,
			publicReference: order.publicReference,
			stripeMs,
			totalMs,
		});
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
