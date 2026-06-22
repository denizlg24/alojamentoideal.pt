import type { AppliedDiscountSnapshot } from "@workspace/db";
import Stripe from "stripe";

export class StripeConfigurationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "StripeConfigurationError";
	}
}

interface StripeEnvironment {
	STRIPE_SECRET_KEY?: string;
}

export function createStripeClientFromEnv(
	environment: StripeEnvironment = {
		STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
	},
): Stripe {
	const secretKey = environment.STRIPE_SECRET_KEY;
	if (!secretKey) {
		throw new StripeConfigurationError("STRIPE_SECRET_KEY is required");
	}

	return new Stripe(secretKey);
}

/**
 * Resolves a customer-entered promotion code into a normalized discount
 * snapshot. Stripe is authoritative: the percentage/amount is read from the
 * coupon, never trusted from the client. Returns `null` when the code is
 * unknown, inactive, or its coupon is no longer valid; genuine Stripe/network
 * failures propagate so callers can distinguish "invalid" from "unavailable".
 */
export async function resolvePromotionCode(
	stripe: Stripe,
	code: string,
): Promise<AppliedDiscountSnapshot | null> {
	const promotionCodes = await stripe.promotionCodes.list({
		active: true,
		code,
		expand: ["data.promotion.coupon"],
		limit: 1,
	});

	const promotionCode = promotionCodes.data[0];
	if (!promotionCode?.active) {
		return null;
	}

	const coupon = promotionCode.promotion?.coupon;
	// Unexpanded (string id) or missing coupon means we cannot trust the value.
	if (!coupon || typeof coupon === "string" || !coupon.valid) {
		return null;
	}

	if (coupon.percent_off != null) {
		return {
			amountMinor: null,
			couponId: coupon.id,
			currency: null,
			percentBasisPoints: Math.round(coupon.percent_off * 100),
			promotionCode: promotionCode.code,
			source: "stripe",
			type: "percentage",
		};
	}

	if (coupon.amount_off != null) {
		return {
			amountMinor: coupon.amount_off,
			couponId: coupon.id,
			currency: coupon.currency?.toUpperCase() ?? null,
			percentBasisPoints: null,
			promotionCode: promotionCode.code,
			source: "stripe",
			type: "fixed",
		};
	}

	return null;
}
