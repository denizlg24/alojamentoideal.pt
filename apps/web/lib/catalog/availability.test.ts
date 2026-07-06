import { describe, expect, test } from "bun:test";
import type { ListingNight } from "@workspace/core/accommodations";
import { buildBookingAvailability } from "./availability";

function night(
	date: string,
	overrides: Partial<ListingNight> = {},
): ListingNight {
	return {
		active: true,
		cta: null,
		ctd: null,
		date,
		minStay: null,
		price: 100,
		...overrides,
	};
}

describe("buildBookingAvailability", () => {
	test("keeps explicit one-night orphan overrides when listing minimum is higher", () => {
		const availability = buildBookingAvailability(
			[
				night("2026-07-09", { minStay: 1 }),
				night("2026-07-10", { active: false }),
			],
			2,
		);

		expect(availability.minStayByDate).toEqual({ "2026-07-09": 1 });
		expect(availability.ctaDates.includes("2026-07-09")).toBe(false);
	});

	test("closes an active night to arrival when no minimum stay can start there", () => {
		const availability = buildBookingAvailability(
			[
				night("2026-07-06", { minStay: 2 }),
				night("2026-07-07", { active: false }),
			],
			2,
		);

		expect(availability.availableDates).toEqual(["2026-07-06"]);
		expect(availability.ctaDates.includes("2026-07-06")).toBe(true);
	});

	test("keeps quote-rejected arrivals active but closed to check-in", () => {
		const availability = buildBookingAvailability(
			[
				night("2026-07-12", { minStay: 1 }),
				night("2026-07-13", { active: false }),
			],
			2,
			new Set(["2026-07-12"]),
		);

		expect(availability.availableDates).toEqual(["2026-07-12"]);
		expect(availability.ctaDates.includes("2026-07-12")).toBe(true);
	});
});
