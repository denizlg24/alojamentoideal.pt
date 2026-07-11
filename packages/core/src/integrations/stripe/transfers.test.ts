import { describe, expect, test } from "bun:test";
import type Stripe from "stripe";
import {
	createConnectedAccountTransfer,
	reverseChargeTransfer,
	reverseConnectedAccountTransfer,
} from "./transfers";

function fakeStripe(options: { transfer: string | null }): {
	calls: {
		reversal: {
			id: string;
			opts: { idempotencyKey?: string };
			params: Stripe.TransferCreateReversalParams;
		}[];
	};
	stripe: Stripe;
} {
	const calls = {
		reversal: [] as {
			id: string;
			opts: { idempotencyKey?: string };
			params: Stripe.TransferCreateReversalParams;
		}[],
	};
	const stripe = {
		paymentIntents: {
			retrieve: async (id: string) => ({
				id,
				latest_charge: {
					id: "ch_1",
					transfer: options.transfer,
				},
			}),
		},
		transfers: {
			createReversal: async (
				id: string,
				params: Stripe.TransferCreateReversalParams,
				opts: { idempotencyKey?: string },
			) => {
				calls.reversal.push({ id, opts, params });
				return { amount: params.amount, id: "trr_1" };
			},
		},
	} as unknown as Stripe;
	return { calls, stripe };
}

describe("reverseChargeTransfer", () => {
	test("reverses the exact amount against the charge transfer", async () => {
		const { calls, stripe } = fakeStripe({ transfer: "tr_1" });
		const result = await reverseChargeTransfer(stripe, {
			amountMinor: 4_500,
			idempotencyKey: "manual_refund:o1:4500:reversal",
			paymentIntentId: "pi_1",
		});

		expect(result).toEqual({
			amountMinor: 4_500,
			id: "trr_1",
			transferId: "tr_1",
		});
		expect(calls.reversal[0]?.id).toBe("tr_1");
		expect(calls.reversal[0]?.params.amount).toBe(4_500);
		expect(calls.reversal[0]?.opts.idempotencyKey).toBe(
			"manual_refund:o1:4500:reversal",
		);
	});

	test("returns null when the charge has no transfer", async () => {
		const { calls, stripe } = fakeStripe({ transfer: null });
		const result = await reverseChargeTransfer(stripe, {
			amountMinor: 4_500,
			idempotencyKey: "key",
			paymentIntentId: "pi_1",
		});
		expect(result).toBeNull();
		expect(calls.reversal).toHaveLength(0);
	});

	test("rejects invalid amounts and missing keys before Stripe", async () => {
		const { stripe } = fakeStripe({ transfer: "tr_1" });
		await expect(
			reverseChargeTransfer(stripe, {
				amountMinor: 0,
				idempotencyKey: "key",
				paymentIntentId: "pi_1",
			}),
		).rejects.toThrow(RangeError);
		await expect(
			reverseChargeTransfer(stripe, {
				amountMinor: 100,
				idempotencyKey: "",
				paymentIntentId: "pi_1",
			}),
		).rejects.toThrow(/idempotency/i);
	});
});

describe("createConnectedAccountTransfer", () => {
	test("links a listing payout to the captured charge with an idempotency key", async () => {
		const calls: { params: Stripe.TransferCreateParams; key?: string }[] = [];
		const stripe = {
			paymentIntents: {
				retrieve: async () => ({
					id: "pi_1",
					latest_charge: { id: "ch_1" },
					status: "succeeded",
				}),
			},
			transfers: {
				create: async (
					params: Stripe.TransferCreateParams,
					options: { idempotencyKey?: string },
				) => {
					calls.push({ params, key: options.idempotencyKey });
					return { amount: params.amount, id: "tr_listing_1" };
				},
			},
		} as unknown as Stripe;

		const result = await createConnectedAccountTransfer(stripe, {
			amountMinor: 12_500,
			currency: "EUR",
			destinationAccountId: "acct_owner",
			idempotencyKey: "listing-transfer:item_1",
			orderId: "order_1",
			orderItemId: "item_1",
			paymentIntentId: "pi_1",
		});

		expect(result).toEqual({
			amountMinor: 12_500,
			id: "tr_listing_1",
			sourceChargeId: "ch_1",
		});
		expect(calls[0]?.params).toMatchObject({
			amount: 12_500,
			currency: "eur",
			destination: "acct_owner",
			source_transaction: "ch_1",
			transfer_group: "order:order_1",
		});
		expect(calls[0]?.key).toBe("listing-transfer:item_1");
	});
});

describe("reverseConnectedAccountTransfer", () => {
	test("reverses the listing transfer directly with the refund key", async () => {
		const { calls, stripe } = fakeStripe({ transfer: null });
		const result = await reverseConnectedAccountTransfer(stripe, {
			amountMinor: 2_500,
			idempotencyKey: "manual_refund:o1:2500:reversal",
			transferId: "tr_listing_1",
		});
		expect(result).toEqual({
			amountMinor: 2_500,
			id: "trr_1",
			transferId: "tr_listing_1",
		});
		expect(calls.reversal[0]?.id).toBe("tr_listing_1");
	});
});
