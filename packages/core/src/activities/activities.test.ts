import { describe, expect, it } from "bun:test";
import type {
	BokunActivityAvailability,
	BokunActivityDetail,
} from "../integrations/bokun";
import {
	type ActivityDeparture,
	type ActivityPricingCategory,
	computeDepartureTotal,
	rateUnitPrice,
	toActivityDetail,
	toActivitySummary,
	toAvailabilityCalendar,
	validateDepartureSelection,
} from "./index";

describe("toActivitySummary", () => {
	it("normalizes difficulty and buckets duration", () => {
		const raw: BokunActivityDetail = {
			id: 1,
			title: "City walk",
			difficultyLevel: "MODERATE",
			durationHours: 3,
		};
		const summary = toActivitySummary(raw, { currency: "EUR" });
		expect(summary?.difficulty).toBe("moderate");
		expect(summary?.duration.totalMinutes).toBe(180);
		expect(summary?.duration.bucket).toBe("half_day");
	});

	it("returns null without an id", () => {
		const summary = toActivitySummary(
			{ title: "orphan" } as BokunActivityDetail,
			{ currency: "EUR" },
		);
		expect(summary).toBeNull();
	});

	it("uses the first gallery photo before the key photo for covers", () => {
		const raw: BokunActivityDetail = {
			id: 1,
			title: "City walk",
			keyPhoto: {
				originalUrl: "https://example.test/key-low.jpg",
			},
			photos: [
				{
					originalUrl: "https://example.test/gallery-full.jpg",
					derived: [{ url: "https://example.test/gallery-thumb.jpg" }],
				},
			],
		};
		const summary = toActivitySummary(raw, { currency: "EUR" });
		expect(summary?.coverPhoto?.url).toBe(
			"https://example.test/gallery-full.jpg",
		);
	});
});

describe("toActivityDetail languages", () => {
	it("prefers guidance languages over the content locale and de-duplicates", () => {
		const raw: BokunActivityDetail = {
			id: 1,
			title: "City walk",
			languages: ["EN_GB"],
			guidanceTypes: [
				{ guidanceType: "GUIDED", languages: ["en", "es", "pt"] },
			],
		};
		const detail = toActivityDetail(raw, { currency: "EUR" });
		expect(detail?.languages).toEqual(["en", "es", "pt"]);
	});

	it("falls back to the normalized content locale without guidance", () => {
		const raw: BokunActivityDetail = {
			id: 1,
			title: "City walk",
			languages: ["EN_GB"],
		};
		const detail = toActivityDetail(raw, { currency: "EUR" });
		expect(detail?.languages).toEqual(["en-GB"]);
	});
});

const rawAvailability = (
	overrides: Partial<BokunActivityAvailability>,
): BokunActivityAvailability => ({
	id: "555_20260715",
	startTime: "14:00",
	startTimeId: 555,
	availabilityCount: 8,
	defaultRateId: 900,
	rates: [
		{
			id: 900,
			title: "Standard",
			pricedPerPerson: true,
			minPerBooking: 1,
			maxPerBooking: 16,
			allPricingCategories: true,
		},
	],
	pricesByRate: [
		{
			activityRateId: 900,
			pricePerCategoryUnit: [
				{
					id: 10,
					amount: { amount: 30, currency: "EUR" },
					minParticipantsRequired: 1,
					maxParticipantsRequired: 8,
				},
				{
					id: 10,
					amount: { amount: 25, currency: "EUR" },
					minParticipantsRequired: 9,
					maxParticipantsRequired: 16,
				},
			],
		},
	],
	...overrides,
});

describe("toAvailabilityCalendar", () => {
	it("parses the ISO date from the availability id and drops sold-out", () => {
		const raw: BokunActivityAvailability[] = [
			rawAvailability({ id: "555_20260715", startTime: "14:00" }),
			rawAvailability({
				id: "556_20260715",
				startTime: "10:00",
				startTimeId: 556,
			}),
			rawAvailability({
				id: "557_20260715",
				startTime: "18:00",
				startTimeId: 557,
				availabilityCount: 0,
			}),
		];
		const calendar = toAvailabilityCalendar(raw, { currency: "EUR" });
		expect(Object.keys(calendar.departuresByDate)).toEqual(["2026-07-15"]);
		const departures = calendar.departuresByDate["2026-07-15"];
		expect(departures).toHaveLength(2);
		// Sorted by start time.
		expect(departures?.map((entry) => entry.startTime)).toEqual([
			"10:00",
			"14:00",
		]);
	});

	it("joins rates with pricesByRate into per-category tiers", () => {
		const calendar = toAvailabilityCalendar([rawAvailability({})], {
			currency: "EUR",
		});
		const departure = calendar.departuresByDate["2026-07-15"]?.[0];
		expect(departure?.defaultRateId).toBe("900");
		const rate = departure?.rates[0];
		expect(rate?.tiersByCategory["10"]).toEqual([
			{ amount: 30, minParticipants: 1, maxParticipants: 8 },
			{ amount: 25, minParticipants: 9, maxParticipants: 16 },
		]);
		expect(rate ? rateUnitPrice(rate, "10", 2) : null).toBe(30);
		expect(rate ? rateUnitPrice(rate, "10", 10) : null).toBe(25);
	});
});

describe("departure selection rules", () => {
	const departure: ActivityDeparture = {
		id: "1_20260715",
		date: "2026-07-15",
		startTime: "10:00",
		startTimeId: "1",
		startTimeLabel: null,
		availabilityCount: 4,
		minParticipants: 2,
		soldOut: false,
		defaultRateId: "900",
		rates: [
			{
				id: "900",
				title: "Standard",
				pricedPerPerson: true,
				minPerBooking: 1,
				maxPerBooking: null,
				pricingCategoryIds: [],
				pricePerBooking: null,
				tiersByCategory: {
					adult: [{ amount: 40, minParticipants: 1, maxParticipants: null }],
					child: [{ amount: 20, minParticipants: 1, maxParticipants: null }],
				},
			},
		],
	};
	const categories: ActivityPricingCategory[] = [
		{
			id: "adult",
			title: "Adult",
			fullTitle: null,
			minAge: null,
			maxAge: null,
			occupancy: 1,
			isDefault: true,
		},
		{
			id: "child",
			title: "Child",
			fullTitle: null,
			minAge: 2,
			maxAge: 12,
			occupancy: 1,
			isDefault: false,
		},
	];

	it("flags a selection below the minimum", () => {
		expect(
			validateDepartureSelection(departure, { adult: 1 }, categories)?.reason,
		).toBe("below_min");
	});

	it("flags a selection over capacity", () => {
		expect(
			validateDepartureSelection(departure, { adult: 5 }, categories)?.reason,
		).toBe("over_capacity");
	});

	it("flags a selection with an unpriced category", () => {
		expect(
			validateDepartureSelection(departure, { adult: 2, senior: 1 }, categories)
				?.reason,
		).toBe("unpriced");
	});

	it("accepts a valid selection and totals it", () => {
		const selection = { adult: 2, child: 1 };
		expect(
			validateDepartureSelection(departure, selection, categories),
		).toBeNull();
		expect(computeDepartureTotal(departure, selection)).toBe(100);
	});
});
