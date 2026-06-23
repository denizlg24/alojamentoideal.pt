import {
	CommerceError,
	type PaymentIntentResponse,
	parseCreatePaymentIntentBody,
} from "@workspace/core/commerce";
import {
	createOrUpdatePaymentIntent,
	createStripeClientFromEnv,
	StripeConfigurationError,
} from "@workspace/core/integrations/stripe";
import {
	commerceErrorResponse,
	commerceService,
	readJson,
	resolveCartOwner,
	validationResponse,
} from "@/lib/api/commerce";
import { withApiRoute } from "@/lib/api/route";

/**
 * Creates (or reuses) the Stripe PaymentIntent backing a draft order so the
 * client can mount Elements. The payable amount is re-read from the persisted
 * order server-side; the client never supplies it. Zero-total orders short
 * circuit with a typed response so checkout can skip Stripe entirely.
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

			// Defense in depth: the order must belong to the cart the client claims.
			if (order.cartId && order.cartId !== parsed.data.cartId) {
				throw new CommerceError("order_not_found", "Order not found.", 404);
			}

			if (order.totalMinor <= 0) {
				const zeroTotal: PaymentIntentResponse = {
					amountMinor: 0,
					checkoutExpiresAt: order.checkoutExpiresAt,
					currency: order.currency,
					kind: "zero_total",
					orderId: order.orderId,
					publicReference: order.publicReference,
				};
				return Response.json(zeroTotal);
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

			const snapshot = await createOrUpdatePaymentIntent(stripe, {
				amountMinor: order.totalMinor,
				cartId: parsed.data.cartId,
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

			const body: PaymentIntentResponse = {
				amountMinor: snapshot.amountMinor,
				checkoutExpiresAt: order.checkoutExpiresAt,
				clientSecret: snapshot.clientSecret,
				currency: snapshot.currency,
				kind: "payment_intent",
				orderId: order.orderId,
				paymentIntentId: snapshot.id,
				publicReference: order.publicReference,
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
