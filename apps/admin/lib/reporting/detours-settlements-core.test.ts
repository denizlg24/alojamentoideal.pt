import { describe, expect, test } from "bun:test";
import {
	buildDetoursSettlementReport,
	type DetoursSettlementPeriod,
	type DetoursSettlementSourceRow,
	detoursSettlementReportToCsv,
	detoursSettlementReportToPdf,
	parseDetoursSettlementPeriod,
} from "./detours-settlements-core";

const period: DetoursSettlementPeriod = {
	from: "2026-07-01",
	fromDate: new Date("2026-07-01T00:00:00.000Z"),
	to: "2026-07-31",
	toExclusiveDate: new Date("2026-08-01T00:00:00.000Z"),
};

function row(
	overrides: Partial<DetoursSettlementSourceRow> = {},
): DetoursSettlementSourceRow {
	return {
		activityDate: "2026-07-12",
		activityTitle: "Douro tour",
		currency: "EUR",
		itemId: "item_1",
		orderId: "order_1",
		orderReference: "AI-2026-ABC",
		orderStatus: "confirmed",
		orderTotalMinor: 20_000,
		providerBookingStatus: "confirmed",
		settlementRecordedAt: new Date("2026-07-08T10:00:00.000Z"),
		stripePaymentIntentId: "pi_1",
		transferredGrossMinor: 10_000,
		...overrides,
	};
}

describe("Detours settlement reporting", () => {
	test("allocates the activity share of an order-level Stripe fee", () => {
		const report = buildDetoursSettlementReport(
			[
				row({ itemId: "item_1", transferredGrossMinor: 6000 }),
				row({
					activityTitle: "Porto walk",
					itemId: "item_2",
					transferredGrossMinor: 4000,
				}),
			],
			{
				period,
				settlementsByPaymentIntent: new Map([
					[
						"pi_1",
						{
							amountMinor: 20_000,
							balanceTransactionId: "txn_1",
							chargeCurrency: "EUR",
							chargeId: "ch_1",
							paymentIntentId: "pi_1",
							stripeFeeCurrency: "EUR",
							stripeFeeMinor: 600,
						},
					],
				]),
				stripeAvailable: true,
			},
		);

		expect(report.rows.map((item) => item.stripeFeeMinor)).toEqual([180, 120]);
		expect(report.totals[0]).toMatchObject({
			itemCount: 2,
			missingFeeItemCount: 0,
			netMinor: 9700,
			orderCount: 1,
			settlementDueMinor: 300,
			stripeFeeMinor: 300,
			transferredGrossMinor: 10_000,
		});
	});

	test("marks fees unavailable when Stripe is not configured", () => {
		const report = buildDetoursSettlementReport([row()], {
			period,
			settlementsByPaymentIntent: new Map(),
			stripeAvailable: false,
		});

		expect(report.feeDataComplete).toBe(false);
		expect(report.rows[0]?.feeStatus).toBe("stripe_unavailable");
		expect(report.rows[0]?.netMinor).toBeNull();
		expect(report.totals[0]?.netMinor).toBeNull();
	});

	test("treats a zero Stripe fee as complete data", () => {
		const report = buildDetoursSettlementReport([row()], {
			period,
			settlementsByPaymentIntent: new Map([
				[
					"pi_1",
					{
						amountMinor: 10_000,
						balanceTransactionId: "txn_1",
						chargeCurrency: "EUR",
						chargeId: "ch_1",
						paymentIntentId: "pi_1",
						stripeFeeCurrency: "EUR",
						stripeFeeMinor: 0,
					},
				],
			]),
			stripeAvailable: true,
		});

		expect(report.feeDataComplete).toBe(true);
		expect(report.rows[0]?.feeStatus).toBe("available");
		expect(report.rows[0]?.stripeFeeMinor).toBe(0);
		expect(report.totals[0]?.missingFeeItemCount).toBe(0);
	});

	test("allocates against the Stripe charged amount when it differs locally", () => {
		const report = buildDetoursSettlementReport(
			[row({ orderTotalMinor: 50_000, transferredGrossMinor: 10_000 })],
			{
				period,
				settlementsByPaymentIntent: new Map([
					[
						"pi_1",
						{
							amountMinor: 20_000,
							balanceTransactionId: "txn_1",
							chargeCurrency: "EUR",
							chargeId: "ch_1",
							paymentIntentId: "pi_1",
							stripeFeeCurrency: "EUR",
							stripeFeeMinor: 600,
						},
					],
				]),
				stripeAvailable: true,
			},
		);

		expect(report.rows[0]?.stripeFeeMinor).toBe(300);
	});

	test("exports CSV with escaped row values", () => {
		const report = buildDetoursSettlementReport(
			[row({ activityTitle: "Kayak, coast" })],
			{
				period,
				settlementsByPaymentIntent: new Map([
					[
						"pi_1",
						{
							amountMinor: 20_000,
							balanceTransactionId: "txn_1",
							chargeCurrency: "EUR",
							chargeId: "ch_1",
							paymentIntentId: "pi_1",
							stripeFeeCurrency: "EUR",
							stripeFeeMinor: 250,
						},
					],
				]),
				stripeAvailable: true,
			},
		);

		const csv = detoursSettlementReportToCsv(report);

		expect(csv).toContain('"Kayak, coast"');
		expect(csv).toContain("AI-2026-ABC");
		expect(csv).toContain("100.00");
	});

	test("parses periods and generates PDF bytes", () => {
		const parsed = parseDetoursSettlementPeriod(
			{ from: "2026-07-10", to: "2026-07-12" },
			new Date("2026-07-08T12:00:00.000Z"),
		);
		expect(parsed.fromDate.toISOString()).toBe("2026-07-10T00:00:00.000Z");
		expect(parsed.toExclusiveDate.toISOString()).toBe(
			"2026-07-13T00:00:00.000Z",
		);

		const pdf = detoursSettlementReportToPdf(
			buildDetoursSettlementReport([row()], {
				period: parsed,
				settlementsByPaymentIntent: new Map(),
				stripeAvailable: false,
			}),
		);
		expect(new TextDecoder().decode(pdf.slice(0, 8))).toBe("%PDF-1.4");
	});
});
