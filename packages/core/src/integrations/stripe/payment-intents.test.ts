import { describe, expect, test } from "bun:test";
import type Stripe from "stripe";
import {
	createOrUpdatePaymentIntent,
	retrievePaymentIntentSettlementSnapshot,
	retrievePaymentIntentSnapshot,
} from "./payment-intents";

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
	retrieveCharge?: (
		id: string,
		params: Stripe.ChargeRetrieveParams,
	) => Partial<Stripe.Charge>;
	update?: (
		id: string,
		params: Stripe.PaymentIntentUpdateParams,
	) => Partial<Stripe.PaymentIntent>;
}): {
	calls: {
		create: CreateCall[];
		retrieveCharge: { id: string; params: Stripe.ChargeRetrieveParams }[];
		update: { id: string; params: Stripe.PaymentIntentUpdateParams }[];
	};
	stripe: Stripe;
} {
	const calls = {
		create: [] as CreateCall[],
		retrieveCharge: [] as {
			id: string;
			params: Stripe.ChargeRetrieveParams;
		}[],
		update: [] as { id: string; params: Stripe.PaymentIntentUpdateParams }[],
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
				calls.update.push({ id, params });
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
		charges: {
			retrieve: async (id: string, params: Stripe.ChargeRetrieveParams) => {
				calls.retrieveCharge.push({ id, params });
				if (!overrides.retrieveCharge) {
					throw new Error("charge retrieve not expected");
				}
				return overrides.retrieveCharge(id, params);
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
		expect(calls.update[0]?.params.amount).toBe(12_345);
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

	test("extracts card display details from an expanded latest charge", async () => {
		const { stripe } = fakeStripe({
			retrieve: (id) => ({
				amount: 12_345,
				client_secret: "pi_secret_existing",
				currency: "eur",
				id,
				latest_charge: {
					payment_method_details: {
						card: { brand: "visa", last4: "4242" },
						type: "card",
					},
				} as Stripe.Charge,
				status: "succeeded",
			}),
		});

		const snapshot = await retrievePaymentIntentSnapshot(stripe, "pi_done", {
			includePaymentMethod: true,
		});

		expect(snapshot.paymentMethod).toEqual({
			brand: "visa",
			last4: "4242",
			type: "card",
		});
	});

	test("routes the full charge to Detours via a destination transfer for activities", async () => {
		const { calls, stripe } = fakeStripe({});

		await createOrUpdatePaymentIntent(stripe, {
			...baseParams,
			idempotencyKey: "pi:order_1",
			onBehalfOf: "acct_detours",
			transferDestination: "acct_detours",
		});

		const call = calls.create[0];
		expect(call?.params.transfer_data).toEqual({ destination: "acct_detours" });
		// No `amount`: the entire charge transfers to the connected account.
		expect(call?.params.transfer_data?.amount).toBeUndefined();
		expect(call?.params.on_behalf_of).toBe("acct_detours");
	});

	test("routes only the activity share for a mixed order", async () => {
		const { calls, stripe } = fakeStripe({});

		await createOrUpdatePaymentIntent(stripe, {
			...baseParams,
			idempotencyKey: "pi:order_1",
			transferAmountMinor: 4_500,
			transferDestination: "acct_detours",
		});

		const call = calls.create[0];
		expect(call?.params.transfer_data).toEqual({
			amount: 4_500,
			destination: "acct_detours",
		});
		// Platform stays merchant of record for the stay portion.
		expect(call?.params.on_behalf_of).toBeUndefined();
		expect(call?.params.metadata).toMatchObject({
			activityTotalMinor: "4500",
		});
	});

	test("patches the transfer amount alongside the amount on an updatable mixed intent", async () => {
		const { calls, stripe } = fakeStripe({
			retrieve: (id) => ({
				amount: 10_000,
				client_secret: "pi_secret_existing",
				currency: "eur",
				id,
				status: "requires_payment_method",
				transfer_data: { amount: 4_000, destination: "acct_detours" },
			}),
		});

		await createOrUpdatePaymentIntent(stripe, {
			...baseParams,
			existingPaymentIntentId: "pi_existing",
			idempotencyKey: "pi:order_1",
			transferAmountMinor: 4_500,
			transferDestination: "acct_detours",
		});

		expect(calls.update).toHaveLength(1);
		expect(calls.update[0]?.params).toEqual({
			amount: 12_345,
			transfer_data: { amount: 4_500 },
		});
	});

	test("never adds transfer_data to an intent created without one", async () => {
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
			transferAmountMinor: 4_500,
			transferDestination: "acct_detours",
		});

		expect(calls.update).toHaveLength(1);
		expect(calls.update[0]?.params).toEqual({ amount: 12_345 });
	});

	test("omits transfer_data for accommodation-only orders", async () => {
		const { calls, stripe } = fakeStripe({});

		await createOrUpdatePaymentIntent(stripe, {
			...baseParams,
			idempotencyKey: "pi:order_1",
		});

		expect(calls.create[0]?.params.transfer_data).toBeUndefined();
		expect(calls.create[0]?.params.on_behalf_of).toBeUndefined();
	});

	test("reads Stripe fee from the latest charge balance transaction", async () => {
		const { calls, stripe } = fakeStripe({
			retrieve: (id) => ({
				amount: 12_345,
				client_secret: "pi_secret_done",
				currency: "eur",
				id,
				latest_charge: "ch_1",
				status: "succeeded",
			}),
			retrieveCharge: (id) => ({
				balance_transaction: {
					currency: "eur",
					fee: 421,
					id: "txn_1",
				} as Stripe.BalanceTransaction,
				currency: "eur",
				id,
			}),
		});

		const snapshot = await retrievePaymentIntentSettlementSnapshot(
			stripe,
			"pi_done",
		);

		expect(calls.retrieveCharge).toEqual([
			{ id: "ch_1", params: { expand: ["balance_transaction"] } },
		]);
		expect(snapshot).toMatchObject({
			amountMinor: 12_345,
			balanceTransactionId: "txn_1",
			chargeCurrency: "EUR",
			chargeId: "ch_1",
			paymentIntentId: "pi_done",
			stripeFeeCurrency: "EUR",
			stripeFeeMinor: 421,
		});
	});
});
