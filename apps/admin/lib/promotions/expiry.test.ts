import { describe, expect, test } from "bun:test";
import { endOfDayIn, PROMOTION_TIME_ZONE } from "./expiry";

describe("endOfDayIn", () => {
	test("uses UTC+0 in Lisbon winter", () => {
		expect(endOfDayIn("2026-01-15", PROMOTION_TIME_ZONE).toISOString()).toBe(
			"2026-01-15T23:59:59.000Z",
		);
	});

	test("uses UTC+1 in Lisbon summer", () => {
		expect(endOfDayIn("2026-07-15", PROMOTION_TIME_ZONE).toISOString()).toBe(
			"2026-07-15T22:59:59.000Z",
		);
	});
});
