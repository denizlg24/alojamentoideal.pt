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

	describe("municipal tax night cap", () => {
		const cityTax = (
			nights: number,
			overrides: Record<string, unknown> = {},
		) => ({
			amount: 3,
			charge_type_label: "3.00 / adult / night",
			fee_charge_type: "Per Adult / Night",
			fee_name: "City Tax",
			fee_type: "tax",
			quantity: 2 * nights,
			total: 6 * nights,
			...overrides,
		});

		const quoteFor = async (
			nights: number,
			fees: Record<string, unknown>[],
			stayTotal: number,
		) => {
			const service = new AccommodationQuoteService({
				client: {
					listings: {
						price: async () => ({
							price: {
								available: true,
								fees: [
									{
										fee_name: "Accommodation",
										fee_type: "accommodation",
										is_base_price: true,
										total: stayTotal,
									},
									...fees,
								],
								nights,
								price: stayTotal,
								total:
									stayTotal +
									fees.reduce((sum, fee) => sum + Number(fee.total ?? 0), 0),
							},
							success: true,
						}),
					} as never,
				},
				currency: "EUR",
				redis,
				ttlSeconds: 0,
			});

			return service.quote({
				adults: 2,
				children: 0,
				dates: { checkIn: "2026-07-01", checkOut: "2026-07-31", nights },
				forceFresh: false,
				guests: 2,
				infants: 0,
				listingId: "123",
				pets: 0,
			});
		};

		test("leaves stays of up to seven nights untouched", async () => {
			const quote = await quoteFor(7, [cityTax(7)], 700);

			expect(quote.taxTotal).toBe(42);
			expect(quote.total).toBe(742);
		});

		test("charges a ten-night stay for seven nights only", async () => {
			const quote = await quoteFor(10, [cityTax(10)], 1000);
			const tax = quote.fees.find((fee) => fee.type === "tax");

			expect(tax).toMatchObject({ quantity: 14, total: 42 });
			expect(quote.taxTotal).toBe(42);
			expect(quote.total).toBe(1042);
		});

		test("does not cap per-stay taxes or other per-night fees", async () => {
			const quote = await quoteFor(
				10,
				[
					cityTax(10, {
						charge_type_label: "per stay",
						fee_charge_type: "Per Stay",
						quantity: 1,
						total: 15,
					}),
					{
						fee_charge_type: "Per Night",
						fee_name: "Pet fee",
						fee_type: "fee",
						total: 50,
					},
				],
				1000,
			);

			expect(quote.taxTotal).toBe(15);
			expect(quote.total).toBe(1065);
		});

		test("does not stack on a tax Hostify already caps", async () => {
			const quote = await quoteFor(
				10,
				[cityTax(10, { cap_length: 7, quantity: 14, total: 42 })],
				1000,
			);

			expect(quote.taxTotal).toBe(42);
			expect(quote.total).toBe(1042);
		});
	});
});
