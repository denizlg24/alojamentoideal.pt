import type { IdentityVerificationStatus } from "@workspace/db";
import Stripe from "stripe";
import { StripeConfigurationError } from "./client";

/**
 * Raised when a webhook payload fails Stripe signature verification. The route
 * maps this to a 400 so Stripe stops retrying a request it can never validate,
 * while genuine configuration/transport errors propagate as 5xx.
 */
export class StripeWebhookSignatureError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "StripeWebhookSignatureError";
	}
}

interface StripeWebhookEnvironment {
	STRIPE_WEBHOOK_SECRET?: string;
}

/**
 * Reads the signing secret used to verify inbound Stripe webhooks. Mirrors
 * `createStripeClientFromEnv` by reading the environment directly and failing
 * loudly when the deployment is missing required Stripe configuration.
 */
export function getStripeWebhookSecret(
	environment: StripeWebhookEnvironment = {
		STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
	},
): string {
	const secret = environment.STRIPE_WEBHOOK_SECRET;
	if (!secret) {
		throw new StripeConfigurationError("STRIPE_WEBHOOK_SECRET is required");
	}
	return secret;
}

/**
 * Verifies a raw webhook payload against its `stripe-signature` header and
 * returns the parsed event. Uses the async constructor so the same code path
 * works under Node and edge crypto. A failed verification is normalized to
 * `StripeWebhookSignatureError`; all other failures propagate unchanged.
 */
export async function constructStripeEvent(
	stripe: Stripe,
	payload: string,
	signature: string,
	secret: string,
): Promise<Stripe.Event> {
	try {
		return await stripe.webhooks.constructEventAsync(
			payload,
			signature,
			secret,
		);
	} catch (error) {
		if (error instanceof Stripe.errors.StripeSignatureVerificationError) {
			throw new StripeWebhookSignatureError(error.message);
		}
		throw error;
	}
}

/** A succeeded PaymentIntent, normalized to the fields the app acts on. */
export interface StripePaymentSucceeded {
	amountReceivedMinor: number;
	/** Uppercase ISO currency, matching how order totals are stored. */
	currency: string;
	orderId: string | null;
	paymentIntentId: string;
	type: "payment_succeeded";
}

/** A failed PaymentIntent, normalized to the fields the app persists. */
export interface StripePaymentFailed {
	failureCode: string | null;
	failureDetail: string | null;
	orderId: string | null;
	paymentIntentId: string;
	type: "payment_failed";
}

/** A Stripe Identity VerificationSession lifecycle transition. */
export interface StripeIdentityUpdated {
	type: "identity_updated";
	/** Order guest this session belongs to when verification came from `/order`. */
	bookingGuestId: string | null;
	sessionId: string;
	/** Account this session belongs to, read from session metadata. */
	userId: string | null;
	status: Exclude<IdentityVerificationStatus, "unstarted">;
	/** ISO timestamp of the Stripe lifecycle event. */
	statusChangedAt: string;
	/** ISO timestamp the session reached `verified`; null otherwise. */
	verifiedAt: string | null;
}

/**
 * The subset of Stripe events the app reacts to, reduced to plain fields. This
 * keeps raw Stripe enums and object shapes inside this package; the route layer
 * dispatches on `type` without depending on the `stripe` SDK.
 */
export type RelevantStripeEvent =
	| StripePaymentSucceeded
	| StripePaymentFailed
	| StripeIdentityUpdated
	| { type: "ignored" };

function identityEvent(
	event: Stripe.Event,
	session: Stripe.Identity.VerificationSession,
	status: StripeIdentityUpdated["status"],
): StripeIdentityUpdated {
	const eventTime = new Date(event.created * 1000).toISOString();
	return {
		type: "identity_updated",
		bookingGuestId: session.metadata?.bookingGuestId ?? null,
		sessionId: session.id,
		userId: session.metadata?.userId ?? null,
		status,
		statusChangedAt: eventTime,
		verifiedAt: status === "verified" ? eventTime : null,
	};
}

/**
 * Reduces a verified Stripe event to the normalized union the app handles.
 * Unrecognized event types collapse to `ignored` so the route can acknowledge
 * them with a 200 and move on.
 */
export function interpretStripeEvent(event: Stripe.Event): RelevantStripeEvent {
	switch (event.type) {
		case "payment_intent.succeeded": {
			const intent = event.data.object;
			return {
				amountReceivedMinor: intent.amount_received,
				currency: intent.currency.toUpperCase(),
				orderId: intent.metadata?.orderId ?? null,
				paymentIntentId: intent.id,
				type: "payment_succeeded",
			};
		}
		case "payment_intent.payment_failed": {
			const intent = event.data.object;
			return {
				failureCode: intent.last_payment_error?.code ?? null,
				failureDetail: intent.last_payment_error?.message ?? null,
				orderId: intent.metadata?.orderId ?? null,
				paymentIntentId: intent.id,
				type: "payment_failed",
			};
		}
		case "identity.verification_session.verified":
			return identityEvent(event, event.data.object, "verified");
		case "identity.verification_session.processing":
			return identityEvent(event, event.data.object, "processing");
		case "identity.verification_session.requires_input":
			return identityEvent(event, event.data.object, "requires_input");
		case "identity.verification_session.canceled":
			return identityEvent(event, event.data.object, "canceled");
		default:
			return { type: "ignored" };
	}
}
