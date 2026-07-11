import { describe, expect, test } from "bun:test";
import type { CartDto, CartItemDto } from "@workspace/core/commerce";
import { cartContentFingerprint } from "./cart-store";

// Only the fields the fingerprint reads are populated; the rest of the DTO is
// irrelevant to these tests, so the fixtures cast through Partial.
function makeItem(overrides: Partial<CartItemDto> = {}): CartItemDto {
	return {
		adults: 2,
		checkIn: "2026-08-01",
		checkOut: "2026-08-04",
		children: 0,
		guests: 2,
		id: "item-1",
		infants: 0,
		listingId: "listing-1",
		pets: 0,
		status: "active",
		...overrides,
	} as CartItemDto;
}

function makeCart(
	items: CartItemDto[],
	status: CartDto["status"] = "draft",
): CartDto {
	return { id: "cart-1", items, status } as CartDto;
}

describe("cartContentFingerprint", () => {
	test("is stable across item order", () => {
		const first = makeItem({ id: "a", listingId: "l-a" });
		const second = makeItem({ id: "b", listingId: "l-b" });
		expect(cartContentFingerprint(makeCart([first, second]))).toBe(
			cartContentFingerprint(makeCart([second, first])),
		);
	});

	test("changes when one stay is swapped for another with the same count", () => {
		const kept = makeItem({ id: "a", listingId: "l-a" });
		const removed = makeItem({ id: "b", listingId: "l-b" });
		const added = makeItem({ id: "c", listingId: "l-c" });
		const before = cartContentFingerprint(makeCart([kept, removed]));
		const after = cartContentFingerprint(makeCart([kept, added]));
		expect(before === after).toBe(false);
	});

	test("changes when a stay's dates change", () => {
		const before = cartContentFingerprint(
			makeCart([makeItem({ checkIn: "2026-08-01", checkOut: "2026-08-04" })]),
		);
		const after = cartContentFingerprint(
			makeCart([makeItem({ checkIn: "2026-08-02", checkOut: "2026-08-05" })]),
		);
		expect(before === after).toBe(false);
	});

	test("changes when a stay's guests change", () => {
		const before = cartContentFingerprint(makeCart([makeItem({ adults: 2 })]));
		const after = cartContentFingerprint(makeCart([makeItem({ adults: 3 })]));
		expect(before === after).toBe(false);
	});

	test("changes when a stay's pet count changes", () => {
		const before = cartContentFingerprint(makeCart([makeItem({ pets: 0 })]));
		const after = cartContentFingerprint(makeCart([makeItem({ pets: 1 })]));
		expect(before === after).toBe(false);
	});

	test("ignores removed items", () => {
		const active = makeItem({ id: "a" });
		const removed = makeItem({ id: "b", status: "removed" });
		expect(cartContentFingerprint(makeCart([active, removed]))).toBe(
			cartContentFingerprint(makeCart([active])),
		);
	});

	test("reports the empty fingerprint for null, non-draft and empty carts", () => {
		expect(cartContentFingerprint(null)).toBe("0");
		expect(cartContentFingerprint(makeCart([], "converted"))).toBe("0");
		expect(cartContentFingerprint(makeCart([makeItem()], "converted"))).toBe(
			"0",
		);
		expect(cartContentFingerprint(makeCart([]))).toBe("0");
	});
});
