import { describe, expect, test } from "bun:test";
import type Stripe from "stripe";
import {
	createGuestIdentityVerificationSession,
	createIdentityVerificationSession,
} from "./identity";

interface IdentitySessionCreateCall {
	opts: { idempotencyKey?: string };
	params: Stripe.Identity.VerificationSessionCreateParams;
}

function fakeStripe(): { calls: IdentitySessionCreateCall[]; stripe: Stripe } {
	const calls: IdentitySessionCreateCall[] = [];
	const stripe = {
		identity: {
			verificationSessions: {
				create: async (
					params: Stripe.Identity.VerificationSessionCreateParams,
					opts: { idempotencyKey?: string },
				) => {
					calls.push({ opts, params });
					return {
						client_secret: "vs_secret_123",
						id: "vs_123",
						status: "requires_input",
						url: "https://verify.stripe.com/start",
					};
				},
			},
		},
	} as unknown as Stripe;

	return { calls, stripe };
}

const DERIVED_ACCOUNT_KEY = /^ai_idv:account:[A-Za-z0-9_-]{43}$/;
const DERIVED_GUEST_KEY = /^ai_idv:guest:[A-Za-z0-9_-]{43}$/;

describe("Stripe Identity verification sessions", () => {
	test("derives a stable account idempotency key without exposing local ids", async () => {
		const first = fakeStripe();
		const second = fakeStripe();

		await createIdentityVerificationSession(first.stripe, {
			idempotencyKey: "attempt_123",
			returnUrl: "https://alojamentoideal.pt/account?identity=complete",
			userId: "user_sensitive_123",
		});
		await createIdentityVerificationSession(second.stripe, {
			idempotencyKey: "attempt_123",
			returnUrl: "https://alojamentoideal.pt/account?identity=complete",
			userId: "user_sensitive_123",
		});

		const key = first.calls[0]?.opts.idempotencyKey;
		expect(key).toMatch(DERIVED_ACCOUNT_KEY);
		expect(key).toBe(second.calls[0]?.opts.idempotencyKey);
		expect(key).not.toContain("user_sensitive_123");
		expect(key).not.toContain("attempt_123");
	});

	test("changes the account idempotency key for a new attempt token", async () => {
		const first = fakeStripe();
		const second = fakeStripe();

		await createIdentityVerificationSession(first.stripe, {
			idempotencyKey: "attempt_123",
			userId: "user_123",
		});
		await createIdentityVerificationSession(second.stripe, {
			idempotencyKey: "attempt_456",
			userId: "user_123",
		});

		expect(first.calls[0]?.opts.idempotencyKey).not.toBe(
			second.calls[0]?.opts.idempotencyKey,
		);
	});

	test("derives a guest idempotency key without exposing order identifiers", async () => {
		const { calls, stripe } = fakeStripe();

		await createGuestIdentityVerificationSession(stripe, {
			bookingGuestId: "guest_sensitive_123",
			idempotencyKey: "attempt_789",
			orderId: "order_sensitive_123",
			providerBookingId: "booking_sensitive_123",
			returnUrl: "https://alojamentoideal.pt/order/AI-123/guests",
		});

		const key = calls[0]?.opts.idempotencyKey;
		expect(key).toMatch(DERIVED_GUEST_KEY);
		expect(key).not.toContain("guest_sensitive_123");
		expect(key).not.toContain("order_sensitive_123");
		expect(key).not.toContain("booking_sensitive_123");
		expect(key).not.toContain("attempt_789");
	});
});
