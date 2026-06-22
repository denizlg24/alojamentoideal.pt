import { describe, expect, test } from "bun:test";
import { AccommodationQuoteService } from "./quote";

const redis = {
	get: async () => null,
	set: async () => undefined,
};

describe("AccommodationQuoteService", () => {
	test("charges tax for every guest without a child adjustment", async () => {
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
			infants: 0,
			listingId: "123",
			pets: 0,
		});

		expect(quote.taxTotal).toBe(12);
		expect(quote.total).toBe(112);
		expect(quote.fees[0]).toMatchObject({
			quantity: 6,
			total: 12,
		});
	});

	test("rewrites per-adult wording to per-guest in fee labels", async () => {
		const service = new AccommodationQuoteService({
			client: {
				listings: {
					price: async () => ({
						price: {
							available: true,
							fees: [
								{
									amount: 2,
									charge_type_label: "Per adult per night",
									fee_name: "Tourist tax per adult",
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
			infants: 2,
			listingId: "123",
			pets: 0,
		});

		expect(quote.infants).toBe(2);
		expect(quote.fees[0]).toMatchObject({
			chargeLabel: "Per guest per night",
			name: "Tourist tax per guest",
		});
	});
});
