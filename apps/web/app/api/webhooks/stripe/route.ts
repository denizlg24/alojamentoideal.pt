import * as Sentry from "@sentry/nextjs";
import type {
	CommerceService,
	OrderCompensationFacts,
	OrderConfirmationFacts,
	OrderFinalizationEmailKind,
} from "@workspace/core/commerce";
import {
	constructStripeEvent,
	createStripeClientFromEnv,
	getStripeWebhookSecret,
	interpretStripeEvent,
	type RelevantStripeEvent,
	retrievePaymentIntentSnapshot,
	retrieveVerifiedIdentityDocumentFields,
	StripeConfigurationError,
	StripeWebhookSignatureError,
} from "@workspace/core/integrations/stripe";
import { hashIdentifier, logger } from "@workspace/core/observability";
import { accountProfileRepository } from "@/lib/api/account";
import {
	commerceService,
	connectedAccountTransferService,
} from "@/lib/api/commerce";
import { withApiRoute } from "@/lib/api/route";
import { sendOrderConfirmationEmail } from "@/lib/email/order-confirmation";
import {
	sendOrderAmountMismatchRefundEmail,
	sendOrderCompensationEmail,
} from "@/lib/email/order-could-not-confirm";
import { sendOrderPendingConfirmationEmail } from "@/lib/email/order-pending";

function stripeSessionLogId(sessionId: string): string {
	return hashIdentifier(`stripe-identity:${sessionId}`);
}

/**
 * Settles an order whose PaymentIntent succeeded under the hold-before-confirm
 * saga.
 * `markOrderPaid` records the captured amount and moves the order to `pending`;
 * `confirmOrderReservations` then flips the provider hold to accepted and is
 * where the single confirmation email originates. Both are idempotent, so a
 * re-delivered event is a no-op. The webhook is only an optimisation: the
 * reconciler cron is the durability authority, so any failure here is logged,
 * never 5xx'd (a retry would just re-find the settled order). A permanent
 * confirm failure, including a malicious or stale client confirming without a
 * provider hold, routes to compensation, which refunds and emails the guest.
 * An amount mismatch follows the same compensation path because money was taken.
 */
async function handlePaymentSucceeded(
	event: Extract<RelevantStripeEvent, { type: "payment_succeeded" }>,
	stripe: ReturnType<typeof createStripeClientFromEnv>,
): Promise<void> {
	if (!event.orderId) {
		logger.warn("Stripe payment_intent.succeeded without orderId metadata", {
			paymentIntentId: event.paymentIntentId,
		});
		return;
	}

	try {
		const service = await commerceService();
		const paymentMethod = await loadPaymentMethodSummary(
			stripe,
			event.paymentIntentId,
		);
		const marked = await service.markOrderPaid(event.orderId, {
			amountMinor: event.amountReceivedMinor,
			currency: event.currency,
			paymentMethod,
		});

		if (marked.outcome === "not_found") {
			logger.warn("Stripe webhook referenced an unknown order", {
				orderId: event.orderId,
			});
			return;
		}
		if (marked.outcome === "amount_mismatch") {
			// The captured amount disagrees with the persisted total: the guest was
			// charged the wrong amount. Compensate (refund) and surface loudly.
			const detail = {
				expectedCurrency: marked.expected.currency,
				expectedMinor: marked.expected.amountMinor,
				orderId: event.orderId,
				paymentIntentId: event.paymentIntentId,
				receivedCurrency: marked.received.currency,
				receivedMinor: marked.received.amountMinor,
			};
			logger.error(
				"Stripe payment amount does not match the order total",
				detail,
			);
			Sentry.captureException(
				new Error("Stripe payment amount does not match the order total"),
				{ extra: detail, level: "error" },
			);
			const compensated = await service.compensateOrder(
				event.orderId,
				"amount_mismatch",
			);
			if (compensated.outcome === "compensated") {
				await sendFinalizationEmail(
					service,
					compensated.compensation.emailKind,
					compensated.compensation,
					() => sendOrderAmountMismatchRefundEmail(compensated.compensation),
				);
			}
			return;
		}
		if (marked.outcome === "already_finalized") {
			return;
		}

		await finalizeReservation(service, event.orderId, event.paymentIntentId);
	} catch (error) {
		const captured = error instanceof Error ? error : new Error(String(error));
		logger.error("Failed to settle paid order from Stripe webhook", {
			error: captured.message,
			orderId: event.orderId,
			paymentIntentId: event.paymentIntentId,
		});
		Sentry.captureException(captured, {
			extra: {
				orderId: event.orderId,
				paymentIntentId: event.paymentIntentId,
			},
			level: "error",
		});
	}
}

async function loadPaymentMethodSummary(
	stripe: ReturnType<typeof createStripeClientFromEnv>,
	paymentIntentId: string,
) {
	try {
		const snapshot = await retrievePaymentIntentSnapshot(
			stripe,
			paymentIntentId,
			{
				includePaymentMethod: true,
			},
		);
		return snapshot.paymentMethod;
	} catch (error) {
		logger.warn("Failed to read Stripe payment method summary", {
			error: error instanceof Error ? error.message : String(error),
			paymentIntentId,
		});
		return null;
	}
}

/**
 * Drives the provider hold confirmation after payment and dispatches the right
 * customer email. Shared by the webhook and any future inline caller.
 */
async function finalizeReservation(
	service: CommerceService,
	orderId: string,
	paymentIntentId: string,
): Promise<void> {
	const result = await service.confirmOrderReservations(orderId);
	switch (result.outcome) {
		case "confirmed":
			await connectedAccountTransferService().reconcile();
			logger.info("Order confirmed: provider holds accepted", {
				orderId,
				paymentIntentId,
			});
			if (!result.confirmation.email) {
				logger.warn("Confirmed order has no contact email; skipping email", {
					orderId,
				});
				await service.markFinalizationEmailSent(orderId, "confirmation");
				return;
			}
			await sendFinalizationEmail(
				service,
				"confirmation",
				result.confirmation,
				() => sendOrderConfirmationEmail(result.confirmation),
			);
			return;
		case "compensated":
			logger.error("Order refunded: provider hold could not be confirmed", {
				orderId,
				paymentIntentId,
			});
			Sentry.captureException(
				new Error("Order refunded: provider hold could not be confirmed"),
				{ extra: { orderId, paymentIntentId }, level: "error" },
			);
			await sendFinalizationEmail(
				service,
				result.compensation.emailKind,
				result.compensation,
				() => sendOrderCompensationEmail(result.compensation),
			);
			return;
		case "manual_recovery":
			logger.error("Order needs manual recovery: auto-refund disabled", {
				orderId,
				paymentIntentId,
			});
			Sentry.captureException(
				new Error("Order needs manual recovery: auto-refund disabled"),
				{ extra: { orderId, paymentIntentId }, level: "error" },
			);
			return;
		case "pending_retry":
			// The hold has not settled yet: the reconciler cron will confirm it. Send
			// the "payment received, finalizing" courtesy email so the guest is not
			// left in silence while it settles.
			await sendPendingNoticeEmail(service, result.pending);
			logger.info("Reservation confirmation deferred to reconciler", {
				orderId,
				outcome: result.outcome,
			});
			return;
		default:
			// not_applicable: nothing to finalize (already settled, or never paid).
			logger.info("Reservation confirmation deferred to reconciler", {
				orderId,
				outcome: result.outcome,
			});
			return;
	}
}

/**
 * Sends the pending-confirmation courtesy email, deduped via the order's
 * `pendingNoticeEmail*` slot so a re-delivered webhook (which re-runs this path
 * while the order is still pending) never double-sends. Best-effort: a failure is
 * logged and left for the reconciler to retry, never surfaced to Stripe.
 */
async function sendPendingNoticeEmail(
	service: CommerceService,
	facts: OrderConfirmationFacts,
): Promise<void> {
	if (!facts.email) {
		return;
	}
	if (!(await service.claimPendingNoticeEmail(facts.orderId))) {
		return;
	}
	try {
		await sendOrderPendingConfirmationEmail(facts);
	} catch (error) {
		logger.warn("Failed to send pending-confirmation email", {
			error: error instanceof Error ? error.message : String(error),
			publicReference: facts.publicReference,
		});
		return;
	}
	try {
		await service.markPendingNoticeEmailSent(facts.orderId);
	} catch (error) {
		logger.warn("Pending-confirmation email sent, but marking it sent failed", {
			error: error instanceof Error ? error.message : String(error),
			publicReference: facts.publicReference,
		});
	}
}

async function sendFinalizationEmail(
	service: CommerceService,
	kind: OrderFinalizationEmailKind,
	facts: OrderConfirmationFacts | OrderCompensationFacts,
	send: () => Promise<void>,
): Promise<void> {
	const claimed = await service.claimFinalizationEmail(facts.orderId, kind);
	if (!claimed) {
		return;
	}

	try {
		await send();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await service.recordFinalizationEmailFailure(facts.orderId, kind, message);
		logger.error("Failed to send order email", {
			error: message,
			publicReference: facts.publicReference,
		});
		return;
	}

	try {
		await service.markFinalizationEmailSent(facts.orderId, kind);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await service.recordFinalizationEmailSentStateFailure(
			facts.orderId,
			kind,
			message,
		);
		logger.error("Order email sent, but marking it sent failed", {
			error: message,
			publicReference: facts.publicReference,
		});
		Sentry.captureException(
			error instanceof Error ? error : new Error(String(error)),
			{
				extra: {
					emailKind: kind,
					orderId: facts.orderId,
					publicReference: facts.publicReference,
				},
				level: "error",
			},
		);
	}
}

/**
 * Records a failed payment attempt without releasing the provider hold. A card
 * decline returns the PaymentIntent to `requires_payment_method`, so the order
 * stays payable and the guest can retry on the same intent (commit 310d246).
 * Releasing the hold here would break retry; an abandoned hold is instead
 * released by the reconciler cron once the checkout window expires.
 */
async function handlePaymentFailed(
	event: Extract<RelevantStripeEvent, { type: "payment_failed" }>,
): Promise<void> {
	if (!event.orderId) {
		return;
	}

	await (await commerceService()).recordOrderPaymentFailure(event.orderId, {
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
	const verifiedFields =
		event.status === "verified"
			? await retrieveVerifiedIdentityDocumentFields(stripe, event.sessionId)
			: undefined;

	if (event.bookingGuestId) {
		const guestId = await (
			await commerceService()
		).applyBookingGuestIdentityStatus({
			bookingGuestId: event.bookingGuestId,
			sessionId: event.sessionId,
			status: event.status,
			statusChangedAt: event.verifiedAt ?? event.statusChangedAt,
			verifiedFields,
		});
		if (!guestId) {
			logger.warn("Stripe identity event referenced an unknown booking guest", {
				bookingGuestId: hashIdentifier(`booking-guest:${event.bookingGuestId}`),
				sessionIdHash: stripeSessionLogId(event.sessionId),
				status: event.status,
			});
		}
		return;
	}

	const repository = accountProfileRepository();
	const knownSession = await repository.hasIdentitySession(event.sessionId);
	if (!knownSession) {
		logger.info(
			"Stripe identity event ignored for a reset or unknown session",
			{
				sessionIdHash: stripeSessionLogId(event.sessionId),
				status: event.status,
			},
		);
		return;
	}

	const userId = await repository.applyIdentityStatus({
		sessionId: event.sessionId,
		status: event.status,
		statusChangedAt: event.verifiedAt ?? event.statusChangedAt,
		verifiedFields,
	});
	if (!userId) {
		logger.warn("Stripe identity event referenced an unknown session", {
			sessionIdHash: stripeSessionLogId(event.sessionId),
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
			await handlePaymentSucceeded(event, stripe);
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
