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
			expect(parsed.data.adults).toBe(2);
			expect(parsed.data.children).toBe(0);
			expect(parsed.data.forceFresh).toBe(false);
			expect(parsed.data.infants).toBe(0);
			expect(parsed.data.pets).toBe(0);
		}
	});

	test("accepts infants without counting them toward the guest split", () => {
		const parsed = parseQuoteBody({
			adults: 2,
			checkIn: "2026-07-01",
			checkOut: "2026-07-03",
			children: 1,
			guests: 3,
			infants: 2,
			listingId: "123",
		});

		expect(parsed.success).toBe(true);
		if (parsed.success) {
			expect(parsed.data.infants).toBe(2);
		}
	});

	test("rejects more than five infants", () => {
		const parsed = parseQuoteBody({
			checkIn: "2026-07-01",
			checkOut: "2026-07-03",
			guests: 2,
			infants: 6,
			listingId: "123",
		});

		expect(parsed.success).toBe(false);
	});

	test("derives adults from guests minus children when adults omitted", () => {
		const parsed = parseQuoteBody({
			checkIn: "2026-07-01",
			checkOut: "2026-07-03",
			children: 2,
			guests: 4,
			listingId: "123",
		});

		expect(parsed.success).toBe(true);
		if (parsed.success) {
			expect(parsed.data.adults).toBe(2);
			expect(parsed.data.children).toBe(2);
			expect(parsed.data.guests).toBe(4);
		}
	});

	test("rejects a split with no room for an adult", () => {
		const parsed = parseQuoteBody({
			checkIn: "2026-07-01",
			checkOut: "2026-07-03",
			children: 2,
			guests: 2,
			listingId: "123",
		});

		expect(parsed.success).toBe(false);
	});

	test("keeps adult and child counts when provided", () => {
		const parsed = parseQuoteBody({
			adults: 2,
			checkIn: "2026-07-01",
			checkOut: "2026-07-03",
			children: 1,
			guests: 3,
			listingId: "123",
		});

		expect(parsed.success).toBe(true);
		if (parsed.success) {
			expect(parsed.data.adults).toBe(2);
			expect(parsed.data.children).toBe(1);
			expect(parsed.data.guests).toBe(3);
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
