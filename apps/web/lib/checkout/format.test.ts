import { describe, expect, test } from "bun:test";
import { formatMinor, guestSummaryLabel, nightsLabel } from "./format";

// The web tsconfig exposes a minimal `expect` (toBe/toEqual only), so these
// assertions derive booleans/strings rather than using richer matchers.
const digitsOnly = (value: string) => value.replace(/[^0-9.]/g, "");

describe("formatMinor", () => {
	test("renders two-decimal currencies from minor units", () => {
		expect(digitsOnly(formatMinor(12_345, "EUR"))).toBe("123.45");
		expect(digitsOnly(formatMinor(0, "EUR"))).toBe("0.00");
		expect(digitsOnly(formatMinor(599, "EUR"))).toBe("5.99");
	});

	test("renders zero-decimal currencies without a fraction", () => {
		expect(formatMinor(1000, "JPY").includes(".")).toBe(false);
		expect(formatMinor(1000, "JPY").replace(/[^0-9]/g, "")).toBe("1000");
	});
});

describe("nightsLabel", () => {
	test("singular and plural", () => {
		expect(nightsLabel(1)).toBe("1 night");
		expect(nightsLabel(4)).toBe("4 nights");
	});
});

describe("guestSummaryLabel", () => {
	test("only includes the categories present", () => {
		expect(guestSummaryLabel({ adults: 1, children: 0, infants: 0 })).toBe(
			"1 adult",
		);
		expect(guestSummaryLabel({ adults: 2, children: 1, infants: 2 })).toBe(
			"2 adults, 1 child, 2 infants",
		);
	});
});
