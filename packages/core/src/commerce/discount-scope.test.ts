import { describe, expect, test } from "bun:test";
import type { AppliedDiscountSnapshot } from "@workspace/db";
import {
	discountScopeOf,
	eligibleDiscountBaseMinor,
	parseDiscountScope,
} from "./discount-scope";

const bases = { activityBaseMinor: 4000, housingBaseMinor: 10_000 };

describe("eligibleDiscountBaseMinor", () => {
	test("limits housing codes to the housing base", () => {
		expect(eligibleDiscountBaseMinor("housing", bases)).toBe(10_000);
	});

	test("limits activity codes to the activity base", () => {
		expect(eligibleDiscountBaseMinor("activities", bases)).toBe(4000);
	});

	test("lets whole-cart codes cover both", () => {
		expect(eligibleDiscountBaseMinor("all", bases)).toBe(14_000);
	});
});

describe("discountScopeOf", () => {
	test("reads snapshots without a scope as whole-cart", () => {
		const legacy: AppliedDiscountSnapshot = {
			amountMinor: null,
			couponId: "co_legacy",
			currency: null,
			percentBasisPoints: 1000,
			promotionCode: "OLD",
			source: "stripe",
			type: "percentage",
		};
		expect(discountScopeOf(legacy)).toBe("all");
		expect(discountScopeOf({ ...legacy, scope: "activities" })).toBe(
			"activities",
		);
	});
});

describe("parseDiscountScope", () => {
	test("accepts only known scopes", () => {
		expect(parseDiscountScope("housing")).toBe("housing");
		expect(parseDiscountScope("both")).toBeNull();
		expect(parseDiscountScope(undefined)).toBeNull();
	});
});
