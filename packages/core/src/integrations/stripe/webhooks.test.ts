import { describe, expect, test } from "bun:test";
import Stripe from "stripe";
import { StripeConfigurationError } from "./client";
import {
	constructStripeEvent,
	getStripeWebhookSecret,
	interpretStripeEvent,
	StripeWebhookSignatureError,
} from "./webhooks";

function paymentIntentEvent(
	type: string,
	object: Partial<Stripe.PaymentIntent>,
): Stripe.Event {
	return { data: { object }, type } as unknown as Stripe.Event;
}

function identitySessionEvent(
	type: string,
	object: Partial<Stripe.Identity.VerificationSession>,
): Stripe.Event {
	return {
		created: Date.UTC(2026, 5, 30, 12, 0, 0) / 1000,
		data: { object },
		type,
	} as unknown as Stripe.Event;
}

function fakeStripe(
	constructEventAsync: (
		payload: string,
		signature: string,
		secret: string,
	) => Promise<Stripe.Event> | Stripe.Event,
): Stripe {
	return {
		webhooks: { constructEventAsync },
	} as unknown as Stripe;
}

const event = { id: "evt_1", type: "payment_intent.succeeded" } as Stripe.Event;

describe("getStripeWebhookSecret", () => {
	test("returns the configured secret", () => {
		expect(getStripeWebhookSecret({ STRIPE_WEBHOOK_SECRET: "whsec_x" })).toBe(
			"whsec_x",
		);
	});

	test("throws a configuration error when unset", () => {
		expect(() => getStripeWebhookSecret({})).toThrow(StripeConfigurationError);
	});
});

describe("constructStripeEvent", () => {
	test("returns the verified event and forwards raw inputs", async () => {
		const calls: { payload: string; secret: string; signature: string }[] = [];
		const stripe = fakeStripe((payload, signature, secret) => {
			calls.push({ payload, secret, signature });
			return event;
		});

		const result = await constructStripeEvent(
			stripe,
			"{raw}",
			"sig",
			"whsec_x",
		);

		expect(result).toBe(event);
		expect(calls).toEqual([
			{ payload: "{raw}", secret: "whsec_x", signature: "sig" },
		]);
	});

	test("normalizes a verification failure to a signature error", async () => {
		const stripe = fakeStripe(() => {
			throw new Stripe.errors.StripeSignatureVerificationError(
				"bad-sig",
				"{raw}",
				{ message: "No signatures found matching the expected signature" },
			);
		});

		await expect(
			constructStripeEvent(stripe, "{raw}", "bad-sig", "whsec_x"),
		).rejects.toBeInstanceOf(StripeWebhookSignatureError);
	});

	test("propagates non-signature construction failures unchanged", async () => {
		const failure = new SyntaxError("Unexpected token");
		const stripe = fakeStripe(() => {
			throw failure;
		});

		await expect(
			constructStripeEvent(stripe, "{raw}", "sig", "whsec_x"),
		).rejects.toBe(failure);
	});
});

describe("interpretStripeEvent", () => {
	test("normalizes a succeeded intent and uppercases the currency", () => {
		const result = interpretStripeEvent(
			paymentIntentEvent("payment_intent.succeeded", {
				amount_received: 12_345,
				currency: "eur",
				id: "pi_1",
				metadata: { orderId: "order_1" } as Stripe.Metadata,
			}),
		);

		expect(result).toEqual({
			amountReceivedMinor: 12_345,
			currency: "EUR",
			orderId: "order_1",
			paymentIntentId: "pi_1",
			type: "payment_succeeded",
		});
	});

	test("reports a null orderId when metadata is missing", () => {
		const result = interpretStripeEvent(
			paymentIntentEvent("payment_intent.succeeded", {
				amount_received: 100,
				currency: "usd",
				id: "pi_2",
				metadata: {} as Stripe.Metadata,
			}),
		);

		expect(result).toMatchObject({ orderId: null, type: "payment_succeeded" });
	});

	test("normalizes a failed intent with its failure detail", () => {
		const result = interpretStripeEvent(
			paymentIntentEvent("payment_intent.payment_failed", {
				id: "pi_3",
				last_payment_error: {
					code: "card_declined",
					message: "Your card was declined.",
				} as Stripe.PaymentIntent.LastPaymentError,
				metadata: { orderId: "order_3" } as Stripe.Metadata,
			}),
		);

		expect(result).toEqual({
			failureCode: "card_declined",
			failureDetail: "Your card was declined.",
			orderId: "order_3",
			paymentIntentId: "pi_3",
			type: "payment_failed",
		});
	});

	test("ignores unrelated event types", () => {
		const result = interpretStripeEvent({
			data: { object: {} },
			type: "charge.refunded",
		} as unknown as Stripe.Event);

		expect(result).toEqual({ type: "ignored" });
	});

	test("normalizes account-scoped identity metadata", () => {
		const result = interpretStripeEvent(
			identitySessionEvent("identity.verification_session.processing", {
				id: "vs_1",
				metadata: { userId: "user_1" } as Stripe.Metadata,
			}),
		);

		expect(result).toEqual({
			bookingGuestId: null,
			sessionId: "vs_1",
			status: "processing",
			statusChangedAt: "2026-06-30T12:00:00.000Z",
			type: "identity_updated",
			userId: "user_1",
			verifiedAt: null,
		});
	});

	test("normalizes order guest identity metadata", () => {
		const result = interpretStripeEvent(
			identitySessionEvent("identity.verification_session.verified", {
				id: "vs_2",
				metadata: { bookingGuestId: "guest_1" } as Stripe.Metadata,
			}),
		);

		expect(result).toEqual({
			bookingGuestId: "guest_1",
			sessionId: "vs_2",
			status: "verified",
			statusChangedAt: "2026-06-30T12:00:00.000Z",
			type: "identity_updated",
			userId: null,
			verifiedAt: "2026-06-30T12:00:00.000Z",
		});
	});
});
