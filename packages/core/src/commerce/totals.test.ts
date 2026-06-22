import { describe, expect, test } from "bun:test";
import { CommerceError } from "./errors";
import { sumCartTotals } from "./totals";

describe("sumCartTotals", () => {
	test("returns zero totals for empty carts", () => {
		const totals = sumCartTotals([], "EUR");

		expect(totals.totalItems).toBe(0);
		expect(totals.validItemCount).toBe(0);
		expect(totals.totalMinor).toBe(0);
		expect(totals.taxMinor).toBe(0);
		expect(totals.currency).toBe("EUR");
	});

	test("sums only active valid quote amounts", () => {
		const totals = sumCartTotals(
			[
				{
					currency: "EUR",
					subtotalMinor: 10_000,
					taxMinor: 600,
					totalMinor: 10_600,
					validationStatus: "valid",
				},
				{
					currency: "EUR",
					subtotalMinor: 20_000,
					taxMinor: 1200,
					totalMinor: 21_200,
					validationStatus: "unavailable",
				},
			],
			"EUR",
		);

		expect(totals.totalItems).toBe(2);
		expect(totals.validItemCount).toBe(1);
		expect(totals.totalMinor).toBe(10_600);
		expect(totals.taxMinor).toBe(600);
	});

	test("aggregates the housing base across valid items only", () => {
		const totals = sumCartTotals(
			[
				{
					currency: "EUR",
					housingFeeMinor: 8000,
					subtotalMinor: 10_000,
					taxMinor: 600,
					totalMinor: 10_600,
					validationStatus: "valid",
				},
				{
					currency: "EUR",
					housingFeeMinor: 16_000,
					subtotalMinor: 20_000,
					taxMinor: 1200,
					totalMinor: 21_200,
					validationStatus: "valid",
				},
				{
					currency: "EUR",
					housingFeeMinor: 5000,
					subtotalMinor: 6000,
					taxMinor: 0,
					totalMinor: 6000,
					validationStatus: "unavailable",
				},
			],
			"EUR",
		);

		expect(totals.housingBaseMinor).toBe(24_000);
	});

	test("treats a missing housing fee as zero", () => {
		const totals = sumCartTotals(
			[
				{
					currency: "EUR",
					housingFeeMinor: null,
					subtotalMinor: 10_000,
					taxMinor: 600,
					totalMinor: 10_600,
					validationStatus: "valid",
				},
			],
			"EUR",
		);

		expect(totals.housingBaseMinor).toBe(0);
	});

	test("keeps default currency when every item is invalid", () => {
		const totals = sumCartTotals(
			[
				{
					currency: "USD",
					subtotalMinor: 10_000,
					taxMinor: 600,
					totalMinor: 10_600,
					validationStatus: "unavailable",
				},
				{
					currency: "GBP",
					subtotalMinor: 20_000,
					taxMinor: 1200,
					totalMinor: 21_200,
					validationStatus: "provider_error",
				},
			],
			"EUR",
		);

		expect(totals.totalItems).toBe(2);
		expect(totals.validItemCount).toBe(0);
		expect(totals.totalMinor).toBe(0);
		expect(totals.taxMinor).toBe(0);
		expect(totals.currency).toBe("EUR");
	});

	test("accumulates large safe integer minor-unit values", () => {
		const totals = sumCartTotals(
			[
				{
					currency: "EUR",
					subtotalMinor: 3_000_000_000,
					taxMinor: 600_000_000,
					totalMinor: 3_600_000_000,
					validationStatus: "valid",
				},
				{
					currency: "EUR",
					subtotalMinor: 4_000_000_000,
					taxMinor: 800_000_000,
					totalMinor: 4_800_000_000,
					validationStatus: "valid",
				},
			],
			"EUR",
		);

		expect(totals.totalItems).toBe(2);
		expect(totals.validItemCount).toBe(2);
		expect(totals.totalMinor).toBe(8_400_000_000);
		expect(totals.taxMinor).toBe(1_400_000_000);
	});

	test("sums zero and negative minor-unit values", () => {
		const totals = sumCartTotals(
			[
				{
					currency: "EUR",
					subtotalMinor: 0,
					taxMinor: 0,
					totalMinor: 0,
					validationStatus: "valid",
				},
				{
					currency: "EUR",
					subtotalMinor: -1000,
					taxMinor: -100,
					totalMinor: -1100,
					validationStatus: "valid",
				},
			],
			"EUR",
		);

		expect(totals.totalItems).toBe(2);
		expect(totals.validItemCount).toBe(2);
		expect(totals.totalMinor).toBe(-1100);
		expect(totals.taxMinor).toBe(-100);
	});

	test("rejects mixed currencies", () => {
		expect(() =>
			sumCartTotals(
				[
					{
						currency: "EUR",
						subtotalMinor: 100,
						taxMinor: 0,
						totalMinor: 100,
						validationStatus: "valid",
					},
					{
						currency: "USD",
						subtotalMinor: 100,
						taxMinor: 0,
						totalMinor: 100,
						validationStatus: "valid",
					},
				],
				"EUR",
			),
		).toThrow(CommerceError);
	});
});
