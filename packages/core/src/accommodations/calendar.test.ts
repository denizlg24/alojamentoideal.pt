import { describe, expect, test } from "bun:test";
import { addDaysIso, findEarliestStay } from "./calendar";
import type { ListingNight } from "./repository";

function night(
	date: string,
	overrides: Partial<ListingNight> = {},
): ListingNight {
	return { active: true, date, minStay: null, price: 100, ...overrides };
}

describe("addDaysIso", () => {
	test("adds days across a month boundary", () => {
		expect(addDaysIso("2026-06-30", 2)).toBe("2026-07-02");
	});
});

describe("findEarliestStay", () => {
	test("returns the first active night as a one-night stay by default", () => {
		const nights = [night("2026-06-21"), night("2026-06-22")];
		expect(findEarliestStay(nights, "2026-06-21")).toEqual({
			checkIn: "2026-06-21",
			checkOut: "2026-06-22",
			nights: 1,
		});
	});

	test("uses the listing-level fallback minimum when a night has no override", () => {
		const nights = [
			// Earliest arrival needs the fallback 3-night stay but has a gap.
			night("2026-06-21"),
			night("2026-06-22", { active: false }),
			night("2026-06-23"),
			night("2026-06-24"),
			night("2026-06-25"),
		];
		expect(findEarliestStay(nights, "2026-06-21", 3)).toEqual({
			checkIn: "2026-06-23",
			checkOut: "2026-06-26",
			nights: 3,
		});
	});

	test("lets an explicit per-night minimum override the listing fallback", () => {
		const nights = [night("2026-06-21", { minStay: 1 }), night("2026-06-22")];
		expect(findEarliestStay(nights, "2026-06-21", 3)).toEqual({
			checkIn: "2026-06-21",
			checkOut: "2026-06-22",
			nights: 1,
		});
	});

	test("skips blocked arrivals", () => {
		const nights = [
			night("2026-06-21", { active: false }),
			night("2026-06-22"),
		];
		expect(findEarliestStay(nights, "2026-06-21")?.checkIn).toBe("2026-06-22");
	});

	test("honours arrival min-stay and needs the whole window active", () => {
		const nights = [
			// Earliest arrival requires 3 nights but the 2nd night is blocked.
			night("2026-06-21", { minStay: 3 }),
			night("2026-06-22", { active: false }),
			night("2026-06-23", { minStay: 2 }),
			night("2026-06-24"),
		];
		expect(findEarliestStay(nights, "2026-06-21")).toEqual({
			checkIn: "2026-06-23",
			checkOut: "2026-06-25",
			nights: 2,
		});
	});

	test("ignores nights before the search floor", () => {
		const nights = [night("2026-06-19"), night("2026-06-25")];
		expect(findEarliestStay(nights, "2026-06-21")?.checkIn).toBe("2026-06-25");
	});

	test("returns null when nothing is bookable", () => {
		const nights = [night("2026-06-21", { active: false })];
		expect(findEarliestStay(nights, "2026-06-21")).toBeNull();
	});
});
