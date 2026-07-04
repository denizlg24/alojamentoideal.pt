import { describe, expect, it } from "bun:test";
import {
	REFUND_PRESET_PERCENTS,
	refundPresetAmountMinor,
	stripeRefundReason,
} from "./refunds";

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
