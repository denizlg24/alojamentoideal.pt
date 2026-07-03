import { describe, expect, test } from "bun:test";
import { cartHasOverlappingStay } from "./cart-matching";

const cart = {
	items: [
		{
			checkIn: "2026-07-01",
			checkOut: "2026-07-05",
			listingId: "home-1",
			status: "active",
		},
		{
			checkIn: "2026-07-10",
			checkOut: "2026-07-12",
			listingId: "home-2",
			status: "removed",
		},
	],
	status: "draft",
};

describe("cartHasOverlappingStay", () => {
	test("matches active stays on the same listing with overlapping selected dates", () => {
		expect(
			cartHasOverlappingStay(cart, {
				checkIn: "2026-07-04",
				checkOut: "2026-07-08",
				listingId: "home-1",
			}),
		).toBe(true);
	});

	test("does not match adjacent, removed or non-draft cart stays", () => {
		expect(
			cartHasOverlappingStay(cart, {
				checkIn: "2026-07-05",
				checkOut: "2026-07-07",
				listingId: "home-1",
			}),
		).toBe(false);
		expect(
			cartHasOverlappingStay(cart, {
				checkIn: "2026-07-10",
				checkOut: "2026-07-12",
				listingId: "home-2",
			}),
		).toBe(false);
		expect(
			cartHasOverlappingStay(
				{ ...cart, status: "converted" },
				{
					checkIn: "2026-07-02",
					checkOut: "2026-07-04",
					listingId: "home-1",
				},
			),
		).toBe(false);
	});
});
