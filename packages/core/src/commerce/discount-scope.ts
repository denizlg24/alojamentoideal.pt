import type { AppliedDiscountSnapshot, DiscountScope } from "@workspace/db";

/** Scope applied to codes that were never assigned one. */
export const DEFAULT_DISCOUNT_SCOPE: DiscountScope = "all";

export function parseDiscountScope(
	value: string | null | undefined,
): DiscountScope | null {
	return value === "housing" || value === "activities" || value === "all"
		? value
		: null;
}

export function discountScopeOf(
	discount: AppliedDiscountSnapshot,
): DiscountScope {
	return discount.scope ?? DEFAULT_DISCOUNT_SCOPE;
}

export function discountCoversHousing(scope: DiscountScope): boolean {
	return scope !== "activities";
}

export function discountCoversActivities(scope: DiscountScope): boolean {
	return scope !== "housing";
}

export interface DiscountBases {
	/** Pre-tax activity price across valid activity items. */
	activityBaseMinor: number;
	/** Pre-tax housing base price across valid stays; excludes fees and tax. */
	housingBaseMinor: number;
}

/** The part of the cart a coupon with `scope` may discount. */
export function eligibleDiscountBaseMinor(
	scope: DiscountScope,
	bases: DiscountBases,
): number {
	return (
		(discountCoversHousing(scope) ? bases.housingBaseMinor : 0) +
		(discountCoversActivities(scope) ? bases.activityBaseMinor : 0)
	);
}
