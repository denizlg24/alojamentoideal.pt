import type { DiscountScope } from "@workspace/db";
import type Stripe from "stripe";
import { z } from "zod";
import {
	DEFAULT_DISCOUNT_SCOPE,
	parseDiscountScope,
} from "../../commerce/discount-scope";

/** Promotion-code metadata key holding the {@link DiscountScope}. */
export const DISCOUNT_SCOPE_METADATA_KEY = "discount_scope";

/** Codes checkout accepts; Stripe allows the same alphabet. */
export const PROMOTION_CODE_PATTERN = /^[A-Za-z0-9-]{1,100}$/;

export const PROMOTION_CODE_EXPAND = [
	"data.promotion.coupon",
	"data.promotion.coupon.applies_to",
];

/**
 * Scope assigned to a promotion code. Codes nobody scoped (for example ones
 * made in the Stripe dashboard) cover the whole cart; an unrecognised value
 * yields null so a typo can never silently change what a code discounts.
 */
export function readPromotionCodeScope(
	metadata: Stripe.Metadata | null | undefined,
): DiscountScope | null {
	const raw = metadata?.[DISCOUNT_SCOPE_METADATA_KEY];
	return raw === undefined ? DEFAULT_DISCOUNT_SCOPE : parseDiscountScope(raw);
}

/** Why checkout refuses a promotion code even though Stripe lists it. */
export type PromotionCodeBlocker =
	| "coupon_unavailable"
	| "customer_restricted"
	| "expired"
	| "first_time_only"
	| "minimum_amount"
	| "product_restricted"
	| "redemption_limit"
	| "unknown_scope"
	| "unsupported_code";

export function expandedCoupon(
	promotionCode: Stripe.PromotionCode,
): Stripe.Coupon | null {
	const coupon = promotionCode.promotion?.coupon;
	return coupon && typeof coupon !== "string" ? coupon : null;
}

/**
 * Checkout computes discounts itself instead of letting Stripe redeem them, so
 * any Stripe-side rule it cannot honour makes the code unusable on the site.
 */
export function promotionCodeBlockers(
	promotionCode: Stripe.PromotionCode,
	now: Date = new Date(),
): PromotionCodeBlocker[] {
	const blockers: PromotionCodeBlocker[] = [];
	const coupon = expandedCoupon(promotionCode);
	const restrictions = promotionCode.restrictions;

	if (!PROMOTION_CODE_PATTERN.test(promotionCode.code)) {
		blockers.push("unsupported_code");
	}
	if (!coupon?.valid) {
		blockers.push("coupon_unavailable");
	}
	if (
		promotionCode.expires_at != null &&
		promotionCode.expires_at * 1000 <= now.getTime()
	) {
		blockers.push("expired");
	}
	if (promotionCode.customer || promotionCode.customer_account) {
		blockers.push("customer_restricted");
	}
	if (restrictions?.first_time_transaction) {
		blockers.push("first_time_only");
	}
	if (restrictions?.minimum_amount != null) {
		blockers.push("minimum_amount");
	}
	if ((coupon?.applies_to?.products?.length ?? 0) > 0) {
		blockers.push("product_restricted");
	}
	// Stripe only counts redemptions it performs itself, so a limit would
	// never be reached here.
	if (
		promotionCode.max_redemptions != null ||
		coupon?.max_redemptions != null
	) {
		blockers.push("redemption_limit");
	}
	if (!readPromotionCodeScope(promotionCode.metadata)) {
		blockers.push("unknown_scope");
	}

	return blockers;
}

export type PromotionDiscount =
	| { type: "percentage"; percentOff: number }
	| { amountMinor: number; currency: string; type: "fixed" };

export function couponDiscount(
	coupon: Stripe.Coupon,
): PromotionDiscount | null {
	if (coupon.percent_off != null) {
		return { percentOff: coupon.percent_off, type: "percentage" };
	}
	if (coupon.amount_off != null && coupon.currency) {
		return {
			amountMinor: coupon.amount_off,
			currency: coupon.currency.toUpperCase(),
			type: "fixed",
		};
	}
	return null;
}

export interface PromotionCodeSummary {
	active: boolean;
	blockers: PromotionCodeBlocker[];
	code: string;
	couponId: string | null;
	createdAt: string;
	discount: PromotionDiscount | null;
	expiresAt: string | null;
	id: string;
	/** Null when the stored metadata value is not a known scope. */
	scope: DiscountScope | null;
	/** False when the scope is the default because none was ever assigned. */
	scopeAssigned: boolean;
}

export function summarizePromotionCode(
	promotionCode: Stripe.PromotionCode,
	now: Date = new Date(),
): PromotionCodeSummary {
	const coupon = expandedCoupon(promotionCode);

	return {
		active: promotionCode.active,
		blockers: promotionCodeBlockers(promotionCode, now),
		code: promotionCode.code,
		couponId: coupon?.id ?? null,
		createdAt: new Date(promotionCode.created * 1000).toISOString(),
		discount: coupon ? couponDiscount(coupon) : null,
		expiresAt:
			promotionCode.expires_at != null
				? new Date(promotionCode.expires_at * 1000).toISOString()
				: null,
		id: promotionCode.id,
		scope: readPromotionCodeScope(promotionCode.metadata),
		scopeAssigned:
			promotionCode.metadata?.[DISCOUNT_SCOPE_METADATA_KEY] !== undefined,
	};
}

/** Upper bound on codes pulled for the admin list; Stripe pages at 100. */
const PROMOTION_CODE_LIST_CAP = 500;

export async function listPromotionCodes(
	stripe: Stripe,
	now: Date = new Date(),
): Promise<PromotionCodeSummary[]> {
	const promotionCodes = await stripe.promotionCodes
		.list({ expand: PROMOTION_CODE_EXPAND, limit: 100 })
		.autoPagingToArray({ limit: PROMOTION_CODE_LIST_CAP });

	return promotionCodes.map((promotionCode) =>
		summarizePromotionCode(promotionCode, now),
	);
}

export async function setPromotionCodeScope(
	stripe: Stripe,
	promotionCodeId: string,
	scope: DiscountScope,
): Promise<void> {
	await stripe.promotionCodes.update(promotionCodeId, {
		metadata: { [DISCOUNT_SCOPE_METADATA_KEY]: scope },
	});
}

export async function setPromotionCodeActive(
	stripe: Stripe,
	promotionCodeId: string,
	active: boolean,
): Promise<void> {
	await stripe.promotionCodes.update(promotionCodeId, { active });
}

export const discountScopeSchema = z.enum(["housing", "activities", "all"]);

export const promotionCodeInputSchema = z.object({
	code: z
		.string()
		.trim()
		.toUpperCase()
		.regex(/^[A-Z0-9-]{3,40}$/, "Use 3 to 40 letters, digits or dashes."),
	discount: z.discriminatedUnion("type", [
		z.object({
			percentOff: z
				.number()
				.gt(0, "Enter a percentage above 0.")
				.max(100, "A percentage cannot exceed 100.")
				.multipleOf(0.01, "Use at most two decimals."),
			type: z.literal("percentage"),
		}),
		z.object({
			amountMinor: z.number().int().positive("Enter an amount above 0."),
			type: z.literal("fixed"),
		}),
	]),
	expiresAt: z.date().nullable(),
	/** Makes a retried submission reuse the same Stripe objects. */
	requestId: z.uuid(),
	scope: discountScopeSchema,
});

export type PromotionCodeInput = z.infer<typeof promotionCodeInputSchema>;

export class PromotionCodeConflictError extends Error {
	constructor(code: string) {
		super(`An active promotion code "${code}" already exists.`);
		this.name = "PromotionCodeConflictError";
	}
}

/**
 * Creates a single-use-per-order coupon and the customer-facing promotion code
 * for it. The scope lives on the promotion code so re-scoping one code never
 * affects another sharing its coupon. A coupon orphaned by a failed promotion
 * code is deleted again.
 */
export async function createPromotionCode(
	stripe: Stripe,
	input: PromotionCodeInput,
	options: { currency: string; now?: Date },
): Promise<PromotionCodeSummary> {
	const existing = await stripe.promotionCodes.list({
		active: true,
		code: input.code,
		limit: 1,
	});
	if (existing.data.length > 0) {
		throw new PromotionCodeConflictError(input.code);
	}

	const coupon = await stripe.coupons.create(
		{
			duration: "once",
			name: input.code,
			...(input.discount.type === "percentage"
				? { percent_off: input.discount.percentOff }
				: {
						amount_off: input.discount.amountMinor,
						currency: options.currency.toLowerCase(),
					}),
		},
		{ idempotencyKey: `promo:${input.requestId}:coupon` },
	);

	try {
		const promotionCode = await stripe.promotionCodes.create(
			{
				code: input.code,
				expand: ["promotion.coupon"],
				...(input.expiresAt
					? { expires_at: Math.floor(input.expiresAt.getTime() / 1000) }
					: {}),
				metadata: { [DISCOUNT_SCOPE_METADATA_KEY]: input.scope },
				promotion: { coupon: coupon.id, type: "coupon" },
			},
			{ idempotencyKey: `promo:${input.requestId}:code` },
		);
		return summarizePromotionCode(promotionCode, options.now);
	} catch (error) {
		await stripe.coupons.del(coupon.id).catch(() => undefined);
		throw error;
	}
}
