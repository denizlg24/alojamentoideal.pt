import { describe, expect, test } from "bun:test";
import {
	type CheckoutResumeState,
	isResumeUsable,
	parseResumeState,
	stayKeyToken,
} from "./resume";

const STAY = {
	adults: 2,
	checkIn: "2026-07-01",
	checkOut: "2026-07-04",
	children: 1,
	guests: 3,
	infants: 0,
	listingId: "listing-1",
};

describe("stayKeyToken", () => {
	test("is stable for the same stay", () => {
		expect(stayKeyToken(STAY)).toBe(stayKeyToken({ ...STAY }));
	});

	test("changes when any stay field changes", () => {
		const base = stayKeyToken(STAY);
		expect(stayKeyToken({ ...STAY, checkOut: "2026-07-05" }) === base).toBe(
			false,
		);
		expect(stayKeyToken({ ...STAY, adults: 3 }) === base).toBe(false);
		expect(stayKeyToken({ ...STAY, listingId: "listing-2" }) === base).toBe(
			false,
		);
	});
});

describe("parseResumeState", () => {
	const valid: CheckoutResumeState = {
		cartId: "cart-1",
		checkoutExpiresAt: "2026-07-01T10:00:00.000Z",
		orderId: "order-1",
		publicReference: "AI-123",
		stayKey: stayKeyToken(STAY),
	};

	test("round-trips valid metadata", () => {
		expect(parseResumeState(JSON.stringify(valid))).toEqual(valid);
	});

	test("accepts a null checkout expiry", () => {
		const withoutExpiry = { ...valid, checkoutExpiresAt: null };
		expect(parseResumeState(JSON.stringify(withoutExpiry))).toEqual(
			withoutExpiry,
		);
	});

	test("rejects null, malformed JSON and wrong shapes", () => {
		expect(parseResumeState(null)).toBe(null);
		expect(parseResumeState("{not json")).toBe(null);
		expect(parseResumeState(JSON.stringify({ cartId: "only" }))).toBe(null);
		expect(
			parseResumeState(JSON.stringify({ ...valid, checkoutExpiresAt: 5 })),
		).toBe(null);
	});
});

describe("isResumeUsable", () => {
	const stayKey = stayKeyToken(STAY);
	const now = Date.parse("2026-07-01T09:00:00.000Z");
	const base: CheckoutResumeState = {
		cartId: "cart-1",
		checkoutExpiresAt: "2026-07-01T10:00:00.000Z",
		orderId: "order-1",
		publicReference: "AI-123",
		stayKey,
	};

	test("is usable for the same stay before expiry", () => {
		expect(isResumeUsable(base, stayKey, now)).toBe(true);
	});

	test("is unusable for a different stay", () => {
		expect(isResumeUsable(base, "other-stay", now)).toBe(false);
	});

	test("is unusable once the checkout window has closed", () => {
		const expired = { ...base, checkoutExpiresAt: "2026-07-01T08:00:00.000Z" };
		expect(isResumeUsable(expired, stayKey, now)).toBe(false);
	});

	test("defers to the server when no expiry is stored", () => {
		const noExpiry = { ...base, checkoutExpiresAt: null };
		expect(isResumeUsable(noExpiry, stayKey, now)).toBe(true);
	});
});
