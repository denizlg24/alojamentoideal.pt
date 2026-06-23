import type { AppliedDiscountSnapshot } from "@workspace/db";
import { CommerceError } from "./errors";

export interface QuoteTotalsInput {
	currency: string;
	/** Pre-tax housing base; null on legacy snapshots predating the column. */
	housingFeeMinor?: number | null;
	subtotalMinor: number;
	taxMinor: number;
	totalMinor: number;
	validationStatus: string;
}

export interface CartTotals {
	currency: string;
	/** Aggregate pre-tax housing base across valid items. The discountable base. */
	housingBaseMinor: number;
	subtotalMinor: number;
	taxMinor: number;
	totalMinor: number;
	totalItems: number;
	validItemCount: number;
}

export function sumCartTotals(
	items: QuoteTotalsInput[],
	defaultCurrency: string,
): CartTotals {
	const totals: CartTotals = {
		currency: defaultCurrency,
		housingBaseMinor: 0,
		subtotalMinor: 0,
		taxMinor: 0,
		totalMinor: 0,
		totalItems: items.length,
		validItemCount: 0,
	};

	for (const item of items) {
		if (item.validationStatus !== "valid") {
			continue;
		}

		if (totals.validItemCount === 0) {
			totals.currency = item.currency;
		}
		if (item.currency !== totals.currency) {
			throw new CommerceError(
				"invalid_request",
				"Cart items must use a single currency.",
				422,
			);
		}

		totals.housingBaseMinor += item.housingFeeMinor ?? 0;
		totals.subtotalMinor += item.subtotalMinor;
		totals.taxMinor += item.taxMinor;
		totals.totalMinor += item.totalMinor;
		totals.validItemCount += 1;
	}

	return totals;
}

/**
 * Resolves a coupon to a discount amount in minor units, applied to the housing
 * base only and capped at it (a discount never touches fees or tax). Percentage
 * coupons use basis points; fixed coupons must match the cart currency or they
 * contribute nothing.
 */
export function computeDiscountMinor(
	discount: AppliedDiscountSnapshot,
	housingBaseMinor: number,
	currency: string,
): number {
	if (housingBaseMinor <= 0) {
		return 0;
	}

	let raw: number;
	if (discount.type === "percentage") {
		raw = Math.round((housingBaseMinor * discount.percentBasisPoints) / 10000);
	} else {
		if (discount.currency.toUpperCase() !== currency.toUpperCase()) {
			return 0;
		}
		raw = discount.amountMinor;
	}

	return Math.max(0, Math.min(raw, housingBaseMinor));
}
