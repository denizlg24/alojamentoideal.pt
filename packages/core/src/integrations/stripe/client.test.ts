import { describe, expect, test } from "bun:test";
import type Stripe from "stripe";
import { resolvePromotionCode } from "./client";

type PromotionCodeListParams = Parameters<Stripe["promotionCodes"]["list"]>[0];

function stripeWithPromotionCode(
	promotionCode: Stripe.PromotionCode,
	onList?: (params: PromotionCodeListParams) => void,
): Stripe {
	return {
		promotionCodes: {
			list: async (params: PromotionCodeListParams) => {
				onList?.(params);
				return { data: [promotionCode] };
			},
		},
	} as unknown as Stripe;
}

function promotionCodeWithCoupon(
	coupon: Record<string, unknown>,
): Stripe.PromotionCode {
	return {
		active: true,
		code: "SAVE10",
		promotion: {
			coupon,
		},
		restrictions: {},
	} as unknown as Stripe.PromotionCode;
}

describe("resolvePromotionCode", () => {
	test("expands coupon product scope before validating restrictions", async () => {
		let listParams: PromotionCodeListParams | undefined;
		const stripe = stripeWithPromotionCode(
			promotionCodeWithCoupon({
				applies_to: { products: [] },
				id: "co_unrestricted",
				percent_off: 10,
				valid: true,
			}),
			(params) => {
				listParams = params;
			},
		);

		await resolvePromotionCode(stripe, "SAVE10");

		expect(listParams?.expand).toEqual([
			"data.promotion.coupon",
			"data.promotion.coupon.applies_to",
		]);
	});

	test("rejects product-scoped coupons", async () => {
		const stripe = stripeWithPromotionCode(
			promotionCodeWithCoupon({
				applies_to: { products: ["prod_123"] },
				id: "co_product_scoped",
				percent_off: 10,
				valid: true,
			}),
		);

		await expect(resolvePromotionCode(stripe, "SAVE10")).resolves.toBeNull();
	});
});
