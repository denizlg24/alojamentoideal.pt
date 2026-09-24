import type { AppliedDiscountSnapshot } from "@workspace/db";
import Stripe from "stripe";
import {
	couponDiscount,
	expandedCoupon,
	PROMOTION_CODE_EXPAND,
	PROMOTION_CODE_PATTERN,
	promotionCodeBlockers,
	readPromotionCodeScope,
} from "./promotions";

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

	// Pin to the version the installed SDK (stripe@22) is generated against so
	// account-level API upgrades cannot silently change field names or behavior.
	return new Stripe(secretKey, { apiVersion: "2026-08-26.dahlia" });
}

/**
 * Resolves a customer-entered promotion code into a normalized discount
 * snapshot. Stripe is authoritative: the percentage/amount is read from the
 * coupon, never trusted from the client. Returns `null` when the code is
 * unknown, inactive, expired, or carries a rule checkout cannot honour; genuine
 * Stripe/network failures propagate so callers can distinguish "invalid" from
 * "unavailable".
 */
export async function resolvePromotionCode(
	stripe: Stripe,
	code: string,
	now: Date = new Date(),
): Promise<AppliedDiscountSnapshot | null> {
	const normalizedCode = code.trim();
	if (!PROMOTION_CODE_PATTERN.test(normalizedCode)) {
		return null;
	}

	const promotionCodes = await stripe.promotionCodes.list({
		active: true,
		code: normalizedCode,
		expand: PROMOTION_CODE_EXPAND,
		limit: 1,
	});

	const promotionCode = promotionCodes.data[0];
	if (!promotionCode?.active) {
		return null;
	}

	// Unexpanded (string id) or missing coupon means we cannot trust the value.
	const coupon = expandedCoupon(promotionCode);
	const scope = readPromotionCodeScope(promotionCode.metadata);
	if (
		!coupon ||
		!scope ||
		promotionCodeBlockers(promotionCode, now).length > 0
	) {
		return null;
	}

	const discount = couponDiscount(coupon);
	if (discount?.type === "percentage") {
		return {
			amountMinor: null,
			couponId: coupon.id,
			currency: null,
			percentBasisPoints: Math.round(discount.percentOff * 100),
			promotionCode: promotionCode.code,
			scope,
			source: "stripe",
			type: "percentage",
		};
	}

	if (discount?.type === "fixed") {
		return {
			amountMinor: discount.amountMinor,
			couponId: coupon.id,
			currency: discount.currency,
			percentBasisPoints: null,
			promotionCode: promotionCode.code,
			scope,
			source: "stripe",
			type: "fixed",
		};
	}

	return null;
}
