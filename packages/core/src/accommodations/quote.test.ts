import { describe, expect, test } from "bun:test";
import { AccommodationQuoteService } from "./quote";

const redis = {
	get: async () => null,
	set: async () => undefined,
};

describe("AccommodationQuoteService", () => {
	test("adjusts adult-only tourist taxes when children are present", async () => {
		const service = new AccommodationQuoteService({
			client: {
				listings: {
					price: async () => ({
						price: {
							available: true,
							fees: [
								{
									amount: 2,
									charge_type_label: "per person per night",
									fee_name: "Tourist tax",
									fee_type: "tax",
									quantity: 6,
									total: 12,
								},
							],
							nights: 2,
							price: 100,
							total: 112,
						},
						success: true,
					}),
				} as never,
			},
			currency: "EUR",
			redis,
			ttlSeconds: 0,
		});

		const quote = await service.quote({
			adults: 2,
			children: 1,
			dates: {
				checkIn: "2026-07-01",
				checkOut: "2026-07-03",
				nights: 2,
			},
			forceFresh: false,
			guests: 3,
			listingId: "123",
			pets: 0,
		});

		expect(quote.taxTotal).toBe(8);
		expect(quote.total).toBe(108);
		expect(quote.fees[0]).toMatchObject({
			adjustedForChildren: true,
			originalTotal: 12,
			quantity: 4,
			total: 8,
		});
	});

	test("does not adjust VAT-style tax lines", async () => {
		const service = new AccommodationQuoteService({
			client: {
				listings: {
					price: async () => ({
						price: {
							available: true,
							fees: [
								{
									amount: 2,
									charge_type_label: "per person per night",
									fee_name: "VAT",
									fee_type: "tax",
									quantity: 6,
									total: 12,
								},
							],
							nights: 2,
							price: 100,
							total: 112,
						},
						success: true,
					}),
				} as never,
			},
			currency: "EUR",
			redis,
			ttlSeconds: 0,
		});

		const quote = await service.quote({
			adults: 2,
			children: 1,
			dates: {
				checkIn: "2026-07-01",
				checkOut: "2026-07-03",
				nights: 2,
			},
			forceFresh: false,
			guests: 3,
			listingId: "123",
			pets: 0,
		});

		expect(quote.taxTotal).toBe(12);
		expect(quote.total).toBe(112);
		expect(quote.fees[0]?.adjustedForChildren).toBe(false);
	});
});
