import { describe, expect, it } from "bun:test";
import {
	activityReversalAmountMinor,
	isPermanentStripeError,
	REFUND_PRESET_PERCENTS,
	refundPresetAmountMinor,
	stripeRefundReason,
} from "./refunds";

describe("activityReversalAmountMinor", () => {
	it("reverses the whole refund on an activity-only order", () => {
		expect(
			activityReversalAmountMinor({
				activityTotalMinor: 10_000,
				attributedItemType: null,
				orderTotalMinor: 10_000,
				refundMinor: 4_000,
			}),
		).toBe(4_000);
	});

	it("reverses the whole refund when attributed to an activity item on a mixed order", () => {
		expect(
			activityReversalAmountMinor({
				activityTotalMinor: 4_500,
				attributedItemType: "activity",
				orderTotalMinor: 30_000,
				refundMinor: 3_000,
			}),
		).toBe(3_000);
	});

	it("reverses nothing when attributed to a stay item", () => {
		expect(
			activityReversalAmountMinor({
				activityTotalMinor: 4_500,
				attributedItemType: "accommodation",
				orderTotalMinor: 30_000,
				refundMinor: 3_000,
			}),
		).toBe(0);
	});

	it("prorates unattributed refunds on mixed orders by activity share", () => {
		// 4500 of 30000 is 15%; 15% of 2000 = 300.
		expect(
			activityReversalAmountMinor({
				activityTotalMinor: 4_500,
				attributedItemType: null,
				orderTotalMinor: 30_000,
				refundMinor: 2_000,
			}),
		).toBe(300);
	});

	it("caps the reversal at the activity total", () => {
		expect(
			activityReversalAmountMinor({
				activityTotalMinor: 1_000,
				attributedItemType: "activity",
				orderTotalMinor: 30_000,
				refundMinor: 5_000,
			}),
		).toBe(1_000);
	});

	it("reverses nothing for accommodation-only orders", () => {
		expect(
			activityReversalAmountMinor({
				activityTotalMinor: 0,
				attributedItemType: null,
				orderTotalMinor: 30_000,
				refundMinor: 5_000,
			}),
		).toBe(0);
	});
});

describe("refundPresetAmountMinor", () => {
	it("returns the exact remainder for 100% (no rounding drift)", () => {
		expect(refundPresetAmountMinor(4201, 100)).toBe(4201);
	});

	it("rounds fractional percents to the nearest cent", () => {
		// 25% of 4201 = 1050.25 -> 1050
		expect(refundPresetAmountMinor(4201, 25)).toBe(1050);
		// 50% of 4201 = 2100.5 -> 2101 (round half up)
		expect(refundPresetAmountMinor(4201, 50)).toBe(2101);
	});

	it("never exceeds the refundable amount and floors at zero", () => {
		expect(refundPresetAmountMinor(0, 100)).toBe(0);
		expect(refundPresetAmountMinor(-500, 50)).toBe(0);
		expect(refundPresetAmountMinor(100, 0)).toBe(0);
		expect(refundPresetAmountMinor(100, 150)).toBe(100);
	});

	it("exposes 25/50/100 presets", () => {
		expect([...REFUND_PRESET_PERCENTS]).toEqual([25, 50, 100]);
	});
});

describe("stripeRefundReason", () => {
	it("passes through Stripe's enumerated reasons", () => {
		expect(stripeRefundReason("requested_by_customer")).toBe(
			"requested_by_customer",
		);
		expect(stripeRefundReason("duplicate")).toBe("duplicate");
		expect(stripeRefundReason("fraudulent")).toBe("fraudulent");
	});

	it("maps our 'other' reason to an omitted Stripe reason", () => {
		expect(stripeRefundReason("other")).toBeUndefined();
	});
});

describe("isPermanentStripeError", () => {
	it("classifies Stripe 4xx error types as permanent", () => {
		for (const type of [
			"StripeInvalidRequestError",
			"StripeCardError",
			"StripeAuthenticationError",
			"StripePermissionError",
			"StripeIdempotencyError",
		]) {
			expect(isPermanentStripeError({ type })).toBe(true);
		}
	});

	it("treats connection, rate limit and Stripe 5xx errors as transient", () => {
		expect(isPermanentStripeError({ type: "StripeConnectionError" })).toBe(
			false,
		);
		expect(isPermanentStripeError({ type: "StripeRateLimitError" })).toBe(
			false,
		);
		expect(isPermanentStripeError({ type: "StripeAPIError" })).toBe(false);
	});

	it("treats non-Stripe errors as transient", () => {
		expect(isPermanentStripeError(new Error("socket hang up"))).toBe(false);
		expect(isPermanentStripeError(null)).toBe(false);
		expect(isPermanentStripeError("boom")).toBe(false);
	});
});
