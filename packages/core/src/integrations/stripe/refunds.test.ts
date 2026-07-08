import { describe, expect, test } from "bun:test";
import type Stripe from "stripe";
import { createRefund } from "./refunds";

interface RefundCall {
	opts: { idempotencyKey?: string };
	params: Stripe.RefundCreateParams;
}

function fakeStripe(): { calls: RefundCall[]; stripe: Stripe } {
	const calls: RefundCall[] = [];
	const stripe = {
		refunds: {
			create: async (
				params: Stripe.RefundCreateParams,
				opts: { idempotencyKey?: string },
			) => {
				calls.push({ opts, params });
				return {
					amount: params.amount ?? 5000,
					id: "re_123",
					status: "succeeded",
				};
			},
		},
	} as unknown as Stripe;
	return { calls, stripe };
}

describe("createRefund", () => {
	test("refunds a specific amount with a caller-provided idempotency key", async () => {
		const { calls, stripe } = fakeStripe();
		const result = await createRefund(stripe, {
			amountMinor: 1000,
			idempotencyKey: "refund:order-1:pi_x:1000",
			paymentIntentId: "pi_x",
			reason: "requested_by_customer",
		});

		expect(result).toEqual({
			amountMinor: 1000,
			id: "re_123",
			status: "succeeded",
		});
		expect(calls[0]?.params.payment_intent).toBe("pi_x");
		expect(calls[0]?.params.amount).toBe(1000);
		expect(calls[0]?.params.reason).toBe("requested_by_customer");
		expect(calls[0]?.opts.idempotencyKey).toBe("refund:order-1:pi_x:1000");
	});

	test("a full refund omits amount and uses the persisted key", async () => {
		const { calls, stripe } = fakeStripe();
		await createRefund(stripe, {
			idempotencyKey: "refund:order-2:pi_y:full",
			paymentIntentId: "pi_y",
		});
		expect(calls[0]?.params.amount).toBeUndefined();
		expect(calls[0]?.opts.idempotencyKey).toBe("refund:order-2:pi_y:full");
	});

	test("reverses the destination transfer when requested", async () => {
		const { calls, stripe } = fakeStripe();
		await createRefund(stripe, {
			idempotencyKey: "refund:order-3:pi_z:full",
			paymentIntentId: "pi_z",
			reverseTransfer: true,
		});
		expect(calls[0]?.params.reverse_transfer).toBe(true);
	});

	test("omits reverse_transfer for plain platform charges", async () => {
		const { calls, stripe } = fakeStripe();
		await createRefund(stripe, {
			idempotencyKey: "refund:order-4:pi_w:full",
			paymentIntentId: "pi_w",
			reverseTransfer: false,
		});
		expect(calls[0]?.params.reverse_transfer).toBeUndefined();
	});

	test("rejects a missing caller-provided idempotency key before Stripe", async () => {
		const { calls, stripe } = fakeStripe();
		await expect(
			createRefund(stripe, {
				paymentIntentId: "pi_missing",
			} as never),
		).rejects.toThrow("Refund idempotency key must be provided");
		expect(calls).toHaveLength(0);
	});

	test("rejects non-positive or fractional refund amounts before Stripe", async () => {
		const { calls, stripe } = fakeStripe();

		await expect(
			createRefund(stripe, {
				amountMinor: 0,
				idempotencyKey: "refund:zero",
				paymentIntentId: "pi_zero",
			}),
		).rejects.toThrow(RangeError);
		await expect(
			createRefund(stripe, {
				amountMinor: -1,
				idempotencyKey: "refund:negative",
				paymentIntentId: "pi_negative",
			}),
		).rejects.toThrow(RangeError);
		await expect(
			createRefund(stripe, {
				amountMinor: 10.5,
				idempotencyKey: "refund:float",
				paymentIntentId: "pi_float",
			}),
		).rejects.toThrow(RangeError);

		expect(calls).toHaveLength(0);
	});
});
