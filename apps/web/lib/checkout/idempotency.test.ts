import { describe, expect, test } from "bun:test";
import {
	cartItemIdempotencyKey,
	randomIdempotencyKey,
	type StayKeyInput,
} from "./idempotency";

// The web tsconfig exposes a minimal `expect` (toBe/toEqual only), so these
// assertions reduce to booleans rather than using richer matchers.
const KEY_PATTERN = /^[A-Za-z0-9._:-]+$/;

const stay: StayKeyInput = {
	adults: 2,
	checkIn: "2026-07-01",
	checkOut: "2026-07-05",
	children: 1,
	guests: 3,
	infants: 0,
	listingId: "listing-42",
	pets: 0,
};

describe("cartItemIdempotencyKey", () => {
	test("is stable for the same stay", () => {
		expect(cartItemIdempotencyKey(stay)).toBe(cartItemIdempotencyKey(stay));
	});

	test("changes when the stay changes", () => {
		expect(
			cartItemIdempotencyKey(stay) ===
				cartItemIdempotencyKey({ ...stay, checkOut: "2026-07-06" }),
		).toBe(false);
		expect(
			cartItemIdempotencyKey(stay) ===
				cartItemIdempotencyKey({ ...stay, guests: 4 }),
		).toBe(false);
		expect(
			cartItemIdempotencyKey(stay) ===
				cartItemIdempotencyKey({ ...stay, pets: 1 }),
		).toBe(false);
	});

	test("satisfies the server key contract (8-160 chars, allowed charset)", () => {
		const key = cartItemIdempotencyKey(stay);
		expect(key.length >= 8 && key.length <= 160).toBe(true);
		expect(KEY_PATTERN.test(key)).toBe(true);
	});
});

describe("randomIdempotencyKey", () => {
	test("is unique per call and well-formed", () => {
		const a = randomIdempotencyKey("discount");
		const b = randomIdempotencyKey("discount");
		expect(a === b).toBe(false);
		expect(a.length >= 8).toBe(true);
		expect(KEY_PATTERN.test(a)).toBe(true);
	});
});
