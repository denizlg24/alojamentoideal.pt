import { describe, expect, test } from "bun:test";
import { cartNoticeBody, parseCartNotice } from "./cart-notice";

describe("parseCartNotice", () => {
	test("round-trips a valid notice", () => {
		const parsed = parseCartNotice(
			JSON.stringify({
				message: "These dates are no longer available.",
				removedTitles: ["Sea View Apartment"],
			}),
		);
		expect(parsed?.message).toBe("These dates are no longer available.");
		expect(parsed?.removedTitles).toEqual(["Sea View Apartment"]);
	});

	test("returns null for missing or malformed input", () => {
		expect(parseCartNotice(null)).toBe(null);
		expect(parseCartNotice("")).toBe(null);
		expect(parseCartNotice("not json")).toBe(null);
		expect(parseCartNotice(JSON.stringify("just a string"))).toBe(null);
		expect(parseCartNotice(JSON.stringify({ removedTitles: [] }))).toBe(null);
		expect(
			parseCartNotice(JSON.stringify({ message: "", removedTitles: [] })),
		).toBe(null);
		expect(parseCartNotice(JSON.stringify({ message: "hi" }))).toBe(null);
	});

	test("drops non-string entries from removedTitles", () => {
		const parsed = parseCartNotice(
			JSON.stringify({ message: "hi", removedTitles: ["a", 2, null, "b"] }),
		);
		expect(parsed?.removedTitles).toEqual(["a", "b"]);
	});
});

describe("cartNoticeBody", () => {
	test("asks the guest to review when nothing was removed", () => {
		const body = cartNoticeBody({
			message: "These dates are no longer available.",
			removedTitles: [],
		});
		expect(body).toBe(
			"These dates are no longer available. Please review your stays and try again.",
		);
	});

	test("names a single removed stay", () => {
		const body = cartNoticeBody({
			message: "These dates are no longer available.",
			removedTitles: ["Sea View Apartment"],
		});
		expect(
			body.includes('We removed "Sea View Apartment" from your cart'),
		).toBe(true);
		expect(body.includes("it is no longer available")).toBe(true);
	});

	test("lists multiple removed stays", () => {
		const body = cartNoticeBody({
			message: "These dates are no longer available.",
			removedTitles: [
				"Sea View Apartment",
				"Porto Loft",
				"Canidelo Beach Flat",
			],
		});
		expect(
			body.includes(
				'"Sea View Apartment", "Porto Loft" and "Canidelo Beach Flat"',
			),
		).toBe(true);
		expect(body.includes("they are no longer available")).toBe(true);
	});
});
