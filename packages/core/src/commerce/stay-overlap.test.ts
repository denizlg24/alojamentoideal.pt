import { describe, expect, test } from "bun:test";
import { findOverlappingStay, stayDateRangesOverlap } from "./stay-overlap";

const base = {
	checkIn: "2026-07-01",
	checkOut: "2026-07-05",
	listingId: "home-1",
};

describe("stayDateRangesOverlap", () => {
	test("matches partial overlaps in either direction", () => {
		expect(
			stayDateRangesOverlap(base, {
				checkIn: "2026-07-04",
				checkOut: "2026-07-08",
				listingId: "home-1",
			}),
		).toBe(true);
		expect(
			stayDateRangesOverlap(base, {
				checkIn: "2026-06-29",
				checkOut: "2026-07-02",
				listingId: "home-1",
			}),
		).toBe(true);
	});

	test("matches contained, containing and exact ranges", () => {
		expect(
			stayDateRangesOverlap(base, {
				checkIn: "2026-07-02",
				checkOut: "2026-07-04",
				listingId: "home-1",
			}),
		).toBe(true);
		expect(
			stayDateRangesOverlap(base, {
				checkIn: "2026-06-30",
				checkOut: "2026-07-06",
				listingId: "home-1",
			}),
		).toBe(true);
		expect(stayDateRangesOverlap(base, base)).toBe(true);
	});

	test("allows adjacent ranges and other listings", () => {
		expect(
			stayDateRangesOverlap(base, {
				checkIn: "2026-07-05",
				checkOut: "2026-07-07",
				listingId: "home-1",
			}),
		).toBe(false);
		expect(
			stayDateRangesOverlap(base, {
				checkIn: "2026-07-03",
				checkOut: "2026-07-07",
				listingId: "home-2",
			}),
		).toBe(false);
	});
});

describe("findOverlappingStay", () => {
	test("returns the first overlapping stay", () => {
		const stays = [
			base,
			{ checkIn: "2026-08-01", checkOut: "2026-08-03", listingId: "home-1" },
		];

		expect(
			findOverlappingStay(stays, {
				checkIn: "2026-07-04",
				checkOut: "2026-07-06",
				listingId: "home-1",
			}),
		).toEqual(base);
	});
});
