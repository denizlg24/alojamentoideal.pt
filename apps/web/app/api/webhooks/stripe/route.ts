import * as Sentry from "@sentry/nextjs";
import {
	constructStripeEvent,
	createStripeClientFromEnv,
	getStripeWebhookSecret,
	interpretStripeEvent,
	type RelevantStripeEvent,
	retrieveVerifiedIdentityDocumentFields,
	StripeConfigurationError,
	StripeWebhookSignatureError,
} from "@workspace/core/integrations/stripe";
import { logger } from "@workspace/core/observability";
import { accountProfileRepository } from "@/lib/api/account";
import { commerceService } from "@/lib/api/commerce";
import { withApiRoute } from "@/lib/api/route";
import { sendOrderConfirmationEmail } from "@/lib/email/order-confirmation";

/**
 * Settles an order whose PaymentIntent succeeded. `markOrderPaid` is idempotent,
 * so a re-delivered event is a no-op and the confirmation email is sent only on
 * the first transition. Email transport failures are logged but never fail the
 * webhook: the order is already confirmed and a 5xx would only trigger a retry
 * that, finding the order finalized, would not resend the email anyway.
 */
async function handlePaymentSucceeded(
	event: Extract<RelevantStripeEvent, { type: "payment_succeeded" }>,
): Promise<void> {
	if (!event.orderId) {
		logger.warn("Stripe payment_intent.succeeded without orderId metadata", {
			paymentIntentId: event.paymentIntentId,
		});
		return;
	}

	const result = await commerceService().markOrderPaid(event.orderId, {
		amountMinor: event.amountReceivedMinor,
		currency: event.currency,
	});

	if (result.outcome === "not_found") {
		logger.warn("Stripe webhook referenced an unknown order", {
			orderId: event.orderId,
		});
		return;
	}
	if (result.outcome === "amount_mismatch") {
		// The captured amount disagrees with the persisted order total. The order
		// is left unconfirmed on purpose; surface it loudly for reconciliation
		// since the customer was charged but the booking is not settled.
		const detail = {
			expectedCurrency: result.expected.currency,
			expectedMinor: result.expected.amountMinor,
			orderId: event.orderId,
			paymentIntentId: event.paymentIntentId,
			receivedCurrency: result.received.currency,
			receivedMinor: result.received.amountMinor,
		};
		logger.error(
			"Stripe payment amount does not match the order total",
			detail,
		);
		Sentry.captureException(
			new Error("Stripe payment amount does not match the order total"),
			{ extra: detail, level: "error" },
		);
		return;
	}
	if (result.outcome === "already_finalized") {
		return;
	}
	if (!result.confirmation.email) {
		logger.warn("Confirmed order has no contact email; skipping email", {
			orderId: event.orderId,
		});
		return;
	}

	try {
		await sendOrderConfirmationEmail(result.confirmation);
	} catch (error) {
		logger.error("Failed to send order confirmation email", {
			error: error instanceof Error ? error.message : String(error),
			orderId: event.orderId,
		});
	}
}

async function handlePaymentFailed(
	event: Extract<RelevantStripeEvent, { type: "payment_failed" }>,
): Promise<void> {
	if (!event.orderId) {
		return;
	}

	await commerceService().markOrderPaymentFailed(event.orderId, {
		failureCode: event.failureCode,
		failureDetail: event.failureDetail,
	});
}

/**
 * Persists a Stripe Identity verification transition against the account
 * identity document ledger. `applyIdentityStatus` matches on the session id and
 * is idempotent, so a re-delivered event resolves to the same state. A session
 * with no matching document row is logged for reconciliation rather than
 * failing the webhook.
 */
async function handleIdentityUpdated(
	event: Extract<RelevantStripeEvent, { type: "identity_updated" }>,
	stripe: ReturnType<typeof createStripeClientFromEnv>,
): Promise<void> {
	const repository = accountProfileRepository();
	const knownSession = await repository.hasIdentitySession(event.sessionId);
	if (!knownSession) {
		logger.info(
			"Stripe identity event ignored for a reset or unknown session",
			{
				sessionId: event.sessionId,
				status: event.status,
			},
		);
		return;
	}

	const verifiedFields =
		event.status === "verified"
			? await retrieveVerifiedIdentityDocumentFields(stripe, event.sessionId)
			: undefined;

	const userId = await repository.applyIdentityStatus({
		sessionId: event.sessionId,
		status: event.status,
		statusChangedAt: event.verifiedAt ?? event.statusChangedAt,
		verifiedFields,
	});
	if (!userId) {
		logger.warn("Stripe identity event referenced an unknown session", {
			sessionId: event.sessionId,
			status: event.status,
		});
	}
}

async function handleStripeEvent(
	event: RelevantStripeEvent,
	stripe: ReturnType<typeof createStripeClientFromEnv>,
): Promise<void> {
	switch (event.type) {
		case "payment_succeeded":
			await handlePaymentSucceeded(event);
			return;
		case "payment_failed":
			await handlePaymentFailed(event);
			return;
		case "identity_updated":
			await handleIdentityUpdated(event, stripe);
			return;
		default:
			return;
	}
}

/**
 * Stripe webhook endpoint. Verifies the signature against the raw body before
 * touching any state. Rate limiting is disabled so Stripe's retry storms are
 * never throttled. A bad signature is a 400 (Stripe stops retrying); missing
 * Stripe configuration is a 500 (we cannot verify and want the retry).
 */
export const POST = withApiRoute(
	{ name: "webhooks.stripe", rateLimit: false },
	async (request: Request): Promise<Response> => {
		const signature = request.headers.get("stripe-signature");
		if (!signature) {
			return Response.json(
				{ error: "Missing stripe-signature header" },
				{ status: 400 },
			);
		}

		const payload = await request.text();

		let secret: string;
		let stripe: ReturnType<typeof createStripeClientFromEnv>;
		try {
			stripe = createStripeClientFromEnv();
			secret = getStripeWebhookSecret();
		} catch (error) {
			if (error instanceof StripeConfigurationError) {
				logger.error("Stripe webhook is not configured", {
					message: error.message,
				});
				return Response.json(
					{ error: "Webhook not configured" },
					{ status: 500 },
				);
			}
			throw error;
		}

		let interpreted: RelevantStripeEvent;
		try {
			const event = await constructStripeEvent(
				stripe,
				payload,
				signature,
				secret,
			);
			interpreted = interpretStripeEvent(event);
		} catch (error) {
			if (error instanceof StripeWebhookSignatureError) {
				return Response.json({ error: "Invalid signature" }, { status: 400 });
			}
			throw error;
		}

		await handleStripeEvent(interpreted, stripe);
		return Response.json({ received: true });
	},
);
