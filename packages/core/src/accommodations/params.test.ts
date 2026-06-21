import { describe, expect, test } from "bun:test";
import { parseAvailabilitySearchParams, parseQuoteBody } from "./params";
import { readThroughJsonCache } from "./redis-cache";

describe("parseAvailabilitySearchParams", () => {
	test("accepts a valid stay window", () => {
		const params = new URLSearchParams({
			checkIn: "2026-07-01",
			checkOut: "2026-07-04",
			guests: "2",
		});

		const parsed = parseAvailabilitySearchParams(params);

		expect(parsed.success).toBe(true);
		if (parsed.success) {
			expect(parsed.data.dates.nights).toBe(3);
			expect(parsed.data.forceFresh).toBe(false);
		}
	});

	test("rejects check-out before check-in", () => {
		const parsed = parseAvailabilitySearchParams(
			new URLSearchParams({
				checkIn: "2026-07-04",
				checkOut: "2026-07-01",
				guests: "2",
			}),
		);

		expect(parsed.success).toBe(false);
	});
});

describe("parseQuoteBody", () => {
	test("normalizes optional pets and forceFresh", () => {
		const parsed = parseQuoteBody({
			checkIn: "2026-07-01",
			checkOut: "2026-07-02",
			guests: 2,
			listingId: "123",
		});

		expect(parsed.success).toBe(true);
		if (parsed.success) {
			expect(parsed.data.forceFresh).toBe(false);
			expect(parsed.data.pets).toBe(0);
		}
	});
});

describe("readThroughJsonCache", () => {
	test("returns cached JSON without calling loader", async () => {
		const redis = {
			get: async () => JSON.stringify({ value: 1 }),
			set: async () => undefined,
		};

		const result = await readThroughJsonCache(
			redis,
			"key",
			60,
			false,
			async () => ({
				value: 2,
			}),
		);

		expect(result).toEqual({ outcome: "hit", value: { value: 1 } });
	});

	test("falls back to loader when Redis is unavailable", async () => {
		const redis = {
			get: async () => {
				throw new Error("down");
			},
			set: async () => undefined,
		};

		const result = await readThroughJsonCache(
			redis,
			"key",
			60,
			false,
			async () => ({
				value: 2,
			}),
		);

		expect(result).toEqual({ outcome: "unavailable", value: { value: 2 } });
	});
});
