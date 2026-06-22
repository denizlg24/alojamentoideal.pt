import { describe, expect, test } from "bun:test";
import type { AccommodationQuoteResult } from "../accommodations";
import { minorUnitFactor, normalizeAccommodationQuoteSnapshot } from "./money";

describe("normalizeAccommodationQuoteSnapshot", () => {
	test("converts quote totals and fees to minor units", () => {
		const snapshot = normalizeAccommodationQuoteSnapshot({
			accountId: "acct_1",
			provider: "hostify",
			quote: quoteFixture({
				fees: [
					{
						amount: 100,
						chargeLabel: "Stay",
						inclusiveTax: 6,
						isBasePrice: true,
						name: "Accommodation",
						quantity: 1,
						total: 100,
						type: "accommodation",
					},
					{
						amount: 12.34,
						chargeLabel: "Per stay",
						inclusiveTax: null,
						isBasePrice: false,
						name: "Cleaning",
						quantity: 1,
						total: 12.34,
						type: "fee",
					},
					{
						amount: 2,
						chargeLabel: "Per guest",
						inclusiveTax: null,
						isBasePrice: false,
						name: "Tourist tax",
						quantity: 3,
						total: 6,
						type: "tax",
					},
				],
				taxTotal: 6,
				total: 118.34,
			}),
			quoteId: "quote_1",
			ttlSeconds: 300,
		});

		expect(snapshot.id).toBe("quote_1");
		expect(snapshot.totalMinor).toBe(11_834);
		expect(snapshot.taxMinor).toBe(600);
		expect(snapshot.subtotalMinor).toBe(11_234);
		expect(snapshot.feeLines[1]?.totalMinor).toBe(1234);
		expect(snapshot.feeLines[0]?.inclusiveTaxMinor).toBe(600);
		// Housing base = base-price net (10_000 - 600 inclusive tax); fees/tax excluded.
		expect(snapshot.housingFeeMinor).toBe(9_400);
	});

	test("synthesizes an accommodation charge when Hostify omits a base line", () => {
		const snapshot = normalizeAccommodationQuoteSnapshot({
			accountId: "acct_1",
			provider: "hostify",
			quote: quoteFixture({
				fees: [
					{
						amount: 10,
						chargeLabel: "Per stay",
						inclusiveTax: null,
						isBasePrice: false,
						name: "Cleaning",
						quantity: 1,
						total: 10,
						type: "fee",
					},
				],
				total: 110,
			}),
			quoteId: "quote_2",
			ttlSeconds: 300,
		});

		expect(snapshot.feeLines[0]?.isBasePrice).toBe(true);
		expect(snapshot.feeLines[0]?.totalMinor).toBe(10_000);
		expect(snapshot.feeLines[1]?.totalMinor).toBe(1000);
	});

	test("uses ISO zero-decimal minor units for currencies such as KRW", () => {
		expect(minorUnitFactor("KRW")).toBe(1);
		expect(minorUnitFactor("XOF")).toBe(1);
		expect(minorUnitFactor("EUR")).toBe(100);
	});
});

function quoteFixture(
	overrides: Partial<AccommodationQuoteResult>,
): AccommodationQuoteResult {
	return {
		adults: 2,
		available: true,
		cache: { outcome: "bypass", ttlSeconds: 300 },
		checkIn: "2026-07-01",
		checkOut: "2026-07-03",
		children: 1,
		cleaningFee: 12.34,
		currency: "EUR",
		expiresAt: "2026-06-22T12:05:00.000Z",
		fees: [],
		fetchedAt: "2026-06-22T12:00:00.000Z",
		guests: 3,
		infants: 0,
		listingId: "123",
		nightlyAverage: 50,
		nights: 2,
		pets: 0,
		symbol: "EUR",
		taxTotal: 0,
		total: 100,
		vatIncluded: 6,
		...overrides,
	};
}
