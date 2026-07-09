import { describe, expect, it } from "bun:test";
import {
	activityRefundPercent,
	parseBokunCancellationPolicy,
	policyRefundAmountMinor,
	stayRefundPercent,
} from "./cancellation-policy";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

function at(base: Date, offsetMs: number): Date {
	return new Date(base.getTime() + offsetMs);
}

describe("stayRefundPercent (legacy rules)", () => {
	const checkIn = new Date("2026-08-01T15:00:00Z");

	it("returns 100% inside the 48h grace window when check-in is 14+ days away", () => {
		const cancel = at(checkIn, -20 * DAY_MS);
		expect(
			stayRefundPercent({
				at: cancel,
				bookedAt: at(cancel, -47 * HOUR_MS),
				checkIn,
			}),
		).toBe(100);
	});

	it("drops to 50% when the grace window expired, even far from check-in", () => {
		const cancel = at(checkIn, -20 * DAY_MS);
		expect(
			stayRefundPercent({
				at: cancel,
				bookedAt: at(cancel, -49 * HOUR_MS),
				checkIn,
			}),
		).toBe(50);
	});

	it("returns 50% between 7 and 13 days before check-in regardless of booking age", () => {
		const cancel = at(checkIn, -8 * DAY_MS);
		expect(
			stayRefundPercent({
				at: cancel,
				bookedAt: at(cancel, -1 * HOUR_MS),
				checkIn,
			}),
		).toBe(50);
		expect(
			stayRefundPercent({
				at: cancel,
				bookedAt: at(cancel, -100 * DAY_MS),
				checkIn,
			}),
		).toBe(50);
	});

	it("returns 0% under 7 days before check-in", () => {
		const cancel = at(checkIn, -6 * DAY_MS);
		expect(
			stayRefundPercent({
				at: cancel,
				bookedAt: at(cancel, -1 * HOUR_MS),
				checkIn,
			}),
		).toBe(0);
	});

	it("returns 0% after check-in", () => {
		const cancel = at(checkIn, 2 * DAY_MS);
		expect(
			stayRefundPercent({
				at: cancel,
				bookedAt: at(cancel, -100 * DAY_MS),
				checkIn,
			}),
		).toBe(0);
	});

	it("honours the exact 14-day and 48-hour boundaries", () => {
		const cancel = at(checkIn, -14 * DAY_MS);
		expect(
			stayRefundPercent({
				at: cancel,
				bookedAt: at(cancel, -48 * HOUR_MS),
				checkIn,
			}),
		).toBe(100);
		// One millisecond past 48h truncates to 48 full hours -> still inside.
		expect(
			stayRefundPercent({
				at: cancel,
				bookedAt: at(cancel, -(48 * HOUR_MS + 1)),
				checkIn,
			}),
		).toBe(100);
		// A full extra hour is over the grace window.
		expect(
			stayRefundPercent({
				at: cancel,
				bookedAt: at(cancel, -49 * HOUR_MS),
				checkIn,
			}),
		).toBe(50);
		// 13 days and change truncates to 13 -> the 7-13 day band.
		expect(
			stayRefundPercent({
				at: at(checkIn, -(14 * DAY_MS - 1)),
				bookedAt: at(checkIn, -15 * DAY_MS),
				checkIn,
			}),
		).toBe(50);
	});
});

describe("parseBokunCancellationPolicy", () => {
	it("parses the live Bokun shape", () => {
		expect(
			parseBokunCancellationPolicy({
				defaultPolicy: true,
				id: 266489,
				penaltyRules: [],
				policyType: "NON_REFUNDABLE",
				policyTypeEnum: "NON_REFUNDABLE",
				simpleCutoffHours: null,
				tax: null,
				title: "Non refundable",
			}),
		).toEqual({
			penaltyRules: [],
			policyType: "NON_REFUNDABLE",
			simpleCutoffHours: null,
			title: "Non refundable",
		});
	});

	it("drops malformed penalty rules individually", () => {
		const parsed = parseBokunCancellationPolicy({
			penaltyRules: [
				{ cutoffHours: 24, percentage: 100 },
				{ cutoffHours: "48", percentage: 50 },
				null,
				{ cutoffHours: -1, percentage: 50 },
			],
			policyType: "ADVANCED",
		});
		expect(parsed?.penaltyRules).toEqual([
			{ cutoffHours: 24, percentage: 100 },
		]);
	});

	it("returns null for non-object payloads", () => {
		expect(parseBokunCancellationPolicy(null)).toBeNull();
		expect(parseBokunCancellationPolicy(undefined)).toBeNull();
		expect(parseBokunCancellationPolicy("policy")).toBeNull();
	});
});

describe("activityRefundPercent", () => {
	const startAt = new Date("2026-08-10T09:00:00Z");

	it("returns 0 once the activity has started, whatever the policy", () => {
		expect(
			activityRefundPercent(
				{
					penaltyRules: [],
					policyType: "FULL_REFUND",
					simpleCutoffHours: null,
					title: null,
				},
				{ at: at(startAt, 1), startAt },
			),
		).toBe(0);
	});

	it("maps NON_REFUNDABLE to 0 and FULL_REFUND to 100", () => {
		const base = {
			penaltyRules: [],
			simpleCutoffHours: null,
			title: null,
		};
		const input = { at: at(startAt, -100 * HOUR_MS), startAt };
		expect(
			activityRefundPercent({ ...base, policyType: "NON_REFUNDABLE" }, input),
		).toBe(0);
		expect(
			activityRefundPercent({ ...base, policyType: "FULL_REFUND" }, input),
		).toBe(100);
	});

	it("applies a simple cutoff as all-or-nothing", () => {
		const policy = {
			penaltyRules: [],
			policyType: "SIMPLE",
			simpleCutoffHours: 48,
			title: null,
		};
		expect(
			activityRefundPercent(policy, {
				at: at(startAt, -49 * HOUR_MS),
				startAt,
			}),
		).toBe(100);
		expect(
			activityRefundPercent(policy, {
				at: at(startAt, -48 * HOUR_MS),
				startAt,
			}),
		).toBe(100);
		expect(
			activityRefundPercent(policy, {
				at: at(startAt, -47 * HOUR_MS),
				startAt,
			}),
		).toBe(0);
	});

	it("picks the strictest penalty window containing the cancellation time", () => {
		const policy = {
			penaltyRules: [
				{ cutoffHours: 24, percentage: 100 },
				{ cutoffHours: 72, percentage: 50 },
			],
			policyType: "ADVANCED",
			simpleCutoffHours: null,
			title: null,
		};
		expect(
			activityRefundPercent(policy, {
				at: at(startAt, -80 * HOUR_MS),
				startAt,
			}),
		).toBe(100);
		expect(
			activityRefundPercent(policy, {
				at: at(startAt, -48 * HOUR_MS),
				startAt,
			}),
		).toBe(50);
		expect(
			activityRefundPercent(policy, {
				at: at(startAt, -12 * HOUR_MS),
				startAt,
			}),
		).toBe(0);
	});

	it("returns null for uninterpretable policies so callers surface manual review", () => {
		expect(
			activityRefundPercent(
				{
					penaltyRules: [],
					policyType: "ADVANCED",
					simpleCutoffHours: null,
					title: null,
				},
				{ at: at(startAt, -100 * HOUR_MS), startAt },
			),
		).toBeNull();
		expect(
			activityRefundPercent(null, { at: at(startAt, -100 * HOUR_MS), startAt }),
		).toBeNull();
	});
});

describe("policyRefundAmountMinor", () => {
	it("returns the exact total at 100% and rounds otherwise", () => {
		expect(policyRefundAmountMinor(4201, 100)).toBe(4201);
		expect(policyRefundAmountMinor(4201, 50)).toBe(2101);
		expect(policyRefundAmountMinor(4201, 0)).toBe(0);
		expect(policyRefundAmountMinor(0, 100)).toBe(0);
	});
});
