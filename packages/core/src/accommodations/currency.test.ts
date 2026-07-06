import { describe, expect, test } from "bun:test";
import { normalizeCurrencyCode } from "./currency";

describe("normalizeCurrencyCode", () => {
	test("normalizes ISO currency codes", () => {
		expect(normalizeCurrencyCode("eur")).toBe("EUR");
		expect(normalizeCurrencyCode(" usd ")).toBe("USD");
	});

	test("maps the Hostify euro symbol to EUR", () => {
		expect(normalizeCurrencyCode("€", "USD")).toBe("EUR");
	});

	test("falls back when the provider value is not an ISO currency code", () => {
		expect(normalizeCurrencyCode("Euro", "eur")).toBe("EUR");
		expect(normalizeCurrencyCode(null, "not-a-code")).toBe("EUR");
		expect(normalizeCurrencyCode("ZZZ")).toBe("EUR");
	});
});
