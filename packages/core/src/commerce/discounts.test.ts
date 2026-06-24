import { describe, expect, test } from "bun:test";
import type {
	AccommodationQuoteFeeSnapshot,
	AppliedDiscountSnapshot,
} from "@workspace/db";
import { feeLineNetMinor, housingFeeMinor } from "./money";
import {
	allocateDiscountByHousingBase,
	buildDiscountChargeRow,
	generatePublicOrderReference,
} from "./orders";
import { computeDiscountMinor } from "./totals";

function percentage(bp: number): AppliedDiscountSnapshot {
	return {
		amountMinor: null,
		couponId: "co_pct",
		currency: null,
		percentBasisPoints: bp,
		promotionCode: "SAVE",
		source: "stripe",
		type: "percentage",
	};
}

function fixed(amountMinor: number, currency: string): AppliedDiscountSnapshot {
	return {
		amountMinor,
		couponId: "co_fixed",
		currency,
		percentBasisPoints: null,
		promotionCode: "FLAT",
		source: "stripe",
		type: "fixed",
	};
}

function feeLine(
	overrides: Partial<AccommodationQuoteFeeSnapshot>,
): AccommodationQuoteFeeSnapshot {
	return {
		amountMinor: null,
		chargeLabel: null,
		inclusiveTaxMinor: null,
		isBasePrice: false,
		name: "Fee",
		providerPayload: null,
		quantity: 1,
		totalMinor: 0,
		type: "fee",
		...overrides,
	};
}

describe("computeDiscountMinor", () => {
	test("applies a percentage to the housing base", () => {
		expect(computeDiscountMinor(percentage(1000), 10_000, "EUR")).toBe(1000);
	});

	test("caps a percentage discount at the housing base", () => {
		expect(computeDiscountMinor(percentage(20_000), 10_000, "EUR")).toBe(
			10_000,
		);
	});

	test("rounds a percentage discount to the nearest minor unit", () => {
		// round(999 * 1250 / 10000) = round(124.875) = 125
		expect(computeDiscountMinor(percentage(1250), 999, "EUR")).toBe(125);
	});

	test("applies a fixed amount in the matching currency", () => {
		expect(computeDiscountMinor(fixed(1500, "EUR"), 10_000, "EUR")).toBe(1500);
	});

	test("caps a fixed amount at the housing base", () => {
		expect(computeDiscountMinor(fixed(20_000, "EUR"), 10_000, "EUR")).toBe(
			10_000,
		);
	});

	test("ignores a fixed amount in a mismatched currency", () => {
		expect(computeDiscountMinor(fixed(1500, "USD"), 10_000, "EUR")).toBe(0);
	});

	test("never discounts a zero housing base", () => {
		expect(computeDiscountMinor(percentage(1000), 0, "EUR")).toBe(0);
	});
});

describe("allocateDiscountByHousingBase", () => {
	test("splits proportionally with the remainder on the last item", () => {
		const allocations = allocateDiscountByHousingBase(
			[10_000, 20_000, 30_000],
			1000,
		);
		expect(allocations).toEqual([166, 333, 501]);
		expect(allocations.reduce((sum, value) => sum + value, 0)).toBe(1000);
	});

	test("assigns the whole discount to a single item", () => {
		expect(allocateDiscountByHousingBase([5000], 999)).toEqual([999]);
	});

	test("returns zeros when there is no discount", () => {
		expect(allocateDiscountByHousingBase([10_000, 20_000], 0)).toEqual([0, 0]);
	});

	test("returns zeros when the housing base is zero", () => {
		expect(allocateDiscountByHousingBase([0, 0], 500)).toEqual([0, 0]);
	});

	test("always sums back to the total discount", () => {
		const bases = [3333, 1, 9999, 42];
		const allocations = allocateDiscountByHousingBase(bases, 777);
		expect(allocations.reduce((sum, value) => sum + value, 0)).toBe(777);
	});
});

describe("housingFeeMinor", () => {
	test("sums the net of base-price lines only", () => {
		const lines = [
			feeLine({ isBasePrice: true, totalMinor: 10_000, type: "accommodation" }),
			feeLine({ totalMinor: 3000, type: "fee" }),
			feeLine({ totalMinor: 600, type: "tax" }),
		];
		expect(housingFeeMinor(lines)).toBe(10_000);
	});

	test("strips inclusive tax from the base-price line", () => {
		const lines = [
			feeLine({
				inclusiveTaxMinor: 2100,
				isBasePrice: true,
				totalMinor: 12_100,
				type: "accommodation",
			}),
		];
		expect(housingFeeMinor(lines)).toBe(10_000);
	});

	test("sums multiple base-price lines", () => {
		const lines = [
			feeLine({ isBasePrice: true, totalMinor: 6000, type: "accommodation" }),
			feeLine({ isBasePrice: true, totalMinor: 4000, type: "accommodation" }),
		];
		expect(housingFeeMinor(lines)).toBe(10_000);
	});
});

describe("feeLineNetMinor", () => {
	test("nets inclusive tax from a non-tax line", () => {
		expect(
			feeLineNetMinor(
				feeLine({ inclusiveTaxMinor: 2100, totalMinor: 12_100 }),
				false,
			),
		).toBe(10_000);
	});

	test("nets a tax line to zero", () => {
		expect(
			feeLineNetMinor(feeLine({ totalMinor: 600, type: "tax" }), true),
		).toBe(0);
	});

	test("preserves a negative line", () => {
		expect(
			feeLineNetMinor(feeLine({ totalMinor: -1000, type: "discount" }), false),
		).toBe(-1000);
	});
});

describe("buildDiscountChargeRow", () => {
	test("records a negative charge referencing the coupon", () => {
		const row = buildDiscountChargeRow(percentage(1000), 167, 4);
		expect(row).toMatchObject({
			grossMinor: -167,
			kind: "discount",
			netMinor: -167,
			position: 4,
			providerChargeId: "co_pct",
			taxMinor: 0,
			unitNetMinor: -167,
		});
		expect(row.name).toContain("SAVE");
	});

	test("normalizes a positive amount to a negative charge", () => {
		expect(buildDiscountChargeRow(fixed(500, "EUR"), 500, 1).grossMinor).toBe(
			-500,
		);
	});
});

describe("generatePublicOrderReference", () => {
	test("formats AI-<year>-<8 hex>", () => {
		const reference = generatePublicOrderReference(
			new Date("2026-06-22T00:00:00.000Z"),
		);
		expect(reference).toMatch(/^AI-2026-[0-9A-F]{8}$/);
	});
});
