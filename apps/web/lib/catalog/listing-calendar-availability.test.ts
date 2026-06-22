import { describe, expect, test } from "bun:test";
import {
	isListingCalendarDateDisabled,
	isListingCalendarDateUnavailable,
	type ListingCalendarSelection,
} from "./listing-calendar-availability";

const activeNights = new Set(["2026-06-21", "2026-06-22", "2026-06-24"]);

function disabled(date: string, selection: ListingCalendarSelection): boolean {
	return isListingCalendarDateDisabled(date, activeNights, selection);
}

function unavailable(
	date: string,
	selection: ListingCalendarSelection,
): boolean {
	return isListingCalendarDateUnavailable(date, activeNights, selection);
}

describe("listing calendar availability", () => {
	test("allows an inactive date as checkout when preceding nights are active", () => {
		const selection = { checkIn: "2026-06-21", checkOut: null };

		expect(disabled("2026-06-23", selection)).toBe(false);
		expect(unavailable("2026-06-23", selection)).toBe(false);
	});

	test("blocks checkout dates that would span an inactive night", () => {
		const selection = { checkIn: "2026-06-21", checkOut: null };

		expect(disabled("2026-06-24", selection)).toBe(true);
		expect(unavailable("2026-06-24", selection)).toBe(true);
	});

	test("keeps the selected checkout endpoint enabled after range selection", () => {
		const selection = { checkIn: "2026-06-21", checkOut: "2026-06-23" };

		expect(disabled("2026-06-23", selection)).toBe(false);
		expect(unavailable("2026-06-23", selection)).toBe(false);
	});

	test("still blocks inactive arrivals when no checkout is being selected", () => {
		const selection = { checkIn: null, checkOut: null };

		expect(disabled("2026-06-23", selection)).toBe(true);
		expect(unavailable("2026-06-23", selection)).toBe(true);
	});
});
