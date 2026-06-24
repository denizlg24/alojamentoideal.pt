import { describe, expect, test } from "bun:test";
import type Stripe from "stripe";
import { createOrUpdatePaymentIntent } from "./payment-intents";

interface CreateCall {
	opts: { idempotencyKey?: string };
	params: Stripe.PaymentIntentCreateParams;
}

function fakeStripe(overrides: {
	create?: (
		params: Stripe.PaymentIntentCreateParams,
		opts: { idempotencyKey?: string },
	) => Partial<Stripe.PaymentIntent>;
	retrieve?: (id: string) => Partial<Stripe.PaymentIntent>;
	update?: (
		id: string,
		params: Stripe.PaymentIntentUpdateParams,
	) => Partial<Stripe.PaymentIntent>;
}): {
	calls: { create: CreateCall[]; update: { id: string; amount?: number }[] };
	stripe: Stripe;
} {
	const calls = {
		create: [] as CreateCall[],
		update: [] as { amount?: number; id: string }[],
	};
	const stripe = {
		paymentIntents: {
			create: async (
				params: Stripe.PaymentIntentCreateParams,
				opts: { idempotencyKey?: string },
			) => {
				calls.create.push({ opts, params });
				return (
					overrides.create?.(params, opts) ?? {
						amount: params.amount,
						client_secret: "pi_secret_new",
						currency: params.currency,
						id: "pi_new",
						status: "requires_payment_method",
					}
				);
			},
			retrieve: async (id: string) => {
				if (!overrides.retrieve) {
					throw new Error("retrieve not expected");
				}
				return overrides.retrieve(id);
			},
			update: async (id: string, params: Stripe.PaymentIntentUpdateParams) => {
				calls.update.push({ amount: params.amount, id });
				return (
					overrides.update?.(id, params) ?? {
						amount: params.amount,
						client_secret: "pi_secret_updated",
						currency: "eur",
						id,
						status: "requires_payment_method",
					}
				);
			},
		},
	} as unknown as Stripe;

	return { calls, stripe };
}

const baseParams = {
	amountMinor: 12_345,
	cartId: "cart_1",
	currency: "EUR",
	environment: "test",
	orderId: "order_1",
	publicReference: "AI-2026-ABC",
};

describe("createOrUpdatePaymentIntent", () => {
	test("creates an intent for the order amount with deterministic idempotency", async () => {
		const { calls, stripe } = fakeStripe({});

		const snapshot = await createOrUpdatePaymentIntent(stripe, {
			...baseParams,
			idempotencyKey: "pi:order_1",
		});

		expect(calls.create).toHaveLength(1);
		const call = calls.create[0];
		expect(call?.params.amount).toBe(12_345);
		expect(call?.params.currency).toBe("eur");
		expect(call?.params.automatic_payment_methods).toEqual({ enabled: true });
		expect(call?.params.metadata).toMatchObject({
			cartId: "cart_1",
			orderId: "order_1",
			publicReference: "AI-2026-ABC",
		});
		expect(call?.opts.idempotencyKey).toBe("pi:order_1");
		expect(snapshot.amountMinor).toBe(12_345);
		expect(snapshot.clientSecret).toBe("pi_secret_new");
		expect(snapshot.currency).toBe("EUR");
	});

	test("reuses an existing updatable intent when the amount is unchanged", async () => {
		const { calls, stripe } = fakeStripe({
			retrieve: (id) => ({
				amount: 12_345,
				client_secret: "pi_secret_existing",
				currency: "eur",
				id,
				status: "requires_payment_method",
			}),
		});

		const snapshot = await createOrUpdatePaymentIntent(stripe, {
			...baseParams,
			existingPaymentIntentId: "pi_existing",
			idempotencyKey: "pi:order_1",
		});

		expect(calls.create).toHaveLength(0);
		expect(calls.update).toHaveLength(0);
		expect(snapshot.clientSecret).toBe("pi_secret_existing");
	});

	test("updates an existing updatable intent when the amount changed", async () => {
		const { calls, stripe } = fakeStripe({
			retrieve: (id) => ({
				amount: 10_000,
				client_secret: "pi_secret_existing",
				currency: "eur",
				id,
				status: "requires_payment_method",
			}),
		});

		await createOrUpdatePaymentIntent(stripe, {
			...baseParams,
			existingPaymentIntentId: "pi_existing",
			idempotencyKey: "pi:order_1",
		});

		expect(calls.update).toHaveLength(1);
		expect(calls.update[0]?.amount).toBe(12_345);
	});

	test("leaves a frozen (succeeded) intent untouched", async () => {
		const { calls, stripe } = fakeStripe({
			retrieve: (id) => ({
				amount: 999,
				client_secret: "pi_secret_done",
				currency: "eur",
				id,
				status: "succeeded",
			}),
		});

		const snapshot = await createOrUpdatePaymentIntent(stripe, {
			...baseParams,
			existingPaymentIntentId: "pi_done",
			idempotencyKey: "pi:order_1",
		});

		expect(calls.update).toHaveLength(0);
		expect(snapshot.status).toBe("succeeded");
	});

	test("throws when Stripe returns no client secret", async () => {
		const { stripe } = fakeStripe({
			create: (params) => ({
				amount: params.amount,
				client_secret: null,
				currency: params.currency,
				id: "pi_no_secret",
				status: "requires_payment_method",
			}),
		});

		await expect(
			createOrUpdatePaymentIntent(stripe, {
				...baseParams,
				idempotencyKey: "pi:order_1",
			}),
		).rejects.toThrow(/client secret/i);
	});
});
