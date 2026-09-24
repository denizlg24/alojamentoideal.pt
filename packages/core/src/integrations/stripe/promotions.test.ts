import { describe, expect, test } from "bun:test";
import type Stripe from "stripe";
import {
	promotionCodeBlockers,
	promotionCodeInputSchema,
	readPromotionCodeScope,
	summarizePromotionCode,
} from "./promotions";

const NOW = new Date("2026-09-01T12:00:00.000Z");
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);

function coupon(overrides: Partial<Stripe.Coupon> = {}): Stripe.Coupon {
	return {
		amount_off: null,
		applies_to: { products: [] },
		created: NOW_SECONDS,
		currency: null,
		duration: "once",
		duration_in_months: null,
		id: "co_123",
		livemode: false,
		max_redemptions: null,
		metadata: {},
		name: "SAVE10",
		object: "coupon",
		percent_off: 10,
		redeem_by: null,
		times_redeemed: 0,
		valid: true,
		...overrides,
	};
}

function promotionCode(
	overrides: Partial<Stripe.PromotionCode> = {},
): Stripe.PromotionCode {
	return {
		active: true,
		code: "SAVE10",
		created: NOW_SECONDS,
		customer: null,
		customer_account: null,
		expires_at: null,
		id: "promo_123",
		livemode: false,
		max_redemptions: null,
		metadata: {},
		object: "promotion_code",
		promotion: { coupon: coupon(), type: "coupon" },
		restrictions: {
			first_time_transaction: false,
			minimum_amount: null,
			minimum_amount_currency: null,
		},
		times_redeemed: 0,
		...overrides,
	};
}

describe("readPromotionCodeScope", () => {
	test("defaults unassigned codes to the whole cart", () => {
		expect(readPromotionCodeScope({})).toBe("all");
		expect(readPromotionCodeScope(null)).toBe("all");
	});

	test("reads an assigned scope", () => {
		expect(readPromotionCodeScope({ discount_scope: "housing" })).toBe(
			"housing",
		);
		expect(readPromotionCodeScope({ discount_scope: "activities" })).toBe(
			"activities",
		);
	});

	test("rejects an unrecognised scope instead of widening it", () => {
		expect(readPromotionCodeScope({ discount_scope: "tours" })).toBeNull();
	});
});

describe("promotionCodeBlockers", () => {
	test("accepts a plain active code", () => {
		expect(promotionCodeBlockers(promotionCode(), NOW)).toEqual([]);
	});

	test("flags expired codes", () => {
		expect(
			promotionCodeBlockers(
				promotionCode({ expires_at: NOW_SECONDS - 60 }),
				NOW,
			),
		).toEqual(["expired"]);
	});

	test("flags Stripe rules checkout cannot honour", () => {
		expect(
			promotionCodeBlockers(
				promotionCode({
					customer: "cus_123",
					promotion: {
						coupon: coupon({ applies_to: { products: ["prod_1"] } }),
						type: "coupon",
					},
					restrictions: {
						first_time_transaction: true,
						minimum_amount: 5000,
						minimum_amount_currency: "eur",
					},
				}),
				NOW,
			),
		).toEqual([
			"customer_restricted",
			"first_time_only",
			"minimum_amount",
			"product_restricted",
		]);
	});

	test("flags an invalid or unexpanded coupon", () => {
		expect(
			promotionCodeBlockers(
				promotionCode({
					promotion: { coupon: coupon({ valid: false }), type: "coupon" },
				}),
				NOW,
			),
		).toEqual(["coupon_unavailable"]);
		expect(
			promotionCodeBlockers(
				promotionCode({ promotion: { coupon: "co_123", type: "coupon" } }),
				NOW,
			),
		).toEqual(["coupon_unavailable"]);
	});

	test("flags codes checkout cannot type and unknown scopes", () => {
		expect(
			promotionCodeBlockers(
				promotionCode({
					code: "SAVE_10",
					metadata: { discount_scope: "tours" },
				}),
				NOW,
			),
		).toEqual(["unsupported_code", "unknown_scope"]);
	});
});

describe("summarizePromotionCode", () => {
	test("normalizes a fixed-amount code with an assigned scope", () => {
		expect(
			summarizePromotionCode(
				promotionCode({
					expires_at: NOW_SECONDS + 3600,
					metadata: { discount_scope: "activities" },
					promotion: {
						coupon: coupon({
							amount_off: 1500,
							currency: "eur",
							percent_off: null,
						}),
						type: "coupon",
					},
				}),
				NOW,
			),
		).toEqual({
			active: true,
			blockers: [],
			code: "SAVE10",
			couponId: "co_123",
			createdAt: NOW.toISOString(),
			discount: { amountMinor: 1500, currency: "EUR", type: "fixed" },
			expiresAt: "2026-09-01T13:00:00.000Z",
			id: "promo_123",
			scope: "activities",
			scopeAssigned: true,
		});
	});

	test("marks a defaulted scope as unassigned", () => {
		const summary = summarizePromotionCode(promotionCode(), NOW);
		expect(summary.scope).toBe("all");
		expect(summary.scopeAssigned).toBe(false);
		expect(summary.discount).toEqual({ percentOff: 10, type: "percentage" });
	});
});

describe("promotionCodeInputSchema", () => {
	const base = {
		code: " summer-25 ",
		discount: { percentOff: 12.5, type: "percentage" },
		expiresAt: null,
		requestId: "5d3c1f36-8a3e-4c47-9f39-0f8f0d6f0a11",
		scope: "all",
	};

	test("uppercases and trims the code", () => {
		const parsed = promotionCodeInputSchema.parse(base);
		expect(parsed.code).toBe("SUMMER-25");
	});

	test("accepts two-decimal percentages", () => {
		expect(
			promotionCodeInputSchema.safeParse({
				...base,
				discount: { percentOff: 33.33, type: "percentage" },
			}).success,
		).toBe(true);
	});

	test("rejects out-of-range percentages and non-positive amounts", () => {
		expect(
			promotionCodeInputSchema.safeParse({
				...base,
				discount: { percentOff: 120, type: "percentage" },
			}).success,
		).toBe(false);
		expect(
			promotionCodeInputSchema.safeParse({
				...base,
				discount: { amountMinor: 0, type: "fixed" },
			}).success,
		).toBe(false);
	});

	test("rejects codes checkout cannot accept", () => {
		expect(
			promotionCodeInputSchema.safeParse({ ...base, code: "SAVE_10" }).success,
		).toBe(false);
		expect(
			promotionCodeInputSchema.safeParse({ ...base, code: "AB" }).success,
		).toBe(false);
	});
});
