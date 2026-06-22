import { describe, expect, test } from "bun:test";
import { CommerceError } from "./errors";
import { assertMutableCart, toCartStatus } from "./state";

describe("assertMutableCart", () => {
	const now = new Date("2026-06-22T12:00:00.000Z");

	test("rejects missing carts", () => {
		const assertNullCart = () => assertMutableCart(null, now);
		const assertUndefinedCart = () => assertMutableCart(undefined, now);

		expect(assertNullCart).toThrow(CommerceError);
		expect(assertNullCart).toThrow("Cart not found.");
		expect(assertUndefinedCart).toThrow(CommerceError);

		try {
			assertNullCart();
		} catch (error) {
			expect(error).toBeInstanceOf(CommerceError);
			expect((error as CommerceError).code).toBe("cart_not_found");
			return;
		}
		throw new Error("Expected missing cart to throw");
	});

	test("accepts a draft cart before expiry", () => {
		expect(() =>
			assertMutableCart(
				{
					expiresAt: new Date("2026-06-23T12:00:00.000Z"),
					id: "cart_1",
					status: "draft",
				},
				now,
			),
		).not.toThrow();
	});

	test("rejects converted carts", () => {
		expect(() =>
			assertMutableCart(
				{
					expiresAt: new Date("2026-06-23T12:00:00.000Z"),
					id: "cart_1",
					status: "converted",
				},
				now,
			),
		).toThrow(CommerceError);
	});

	test("rejects carts with expired status before checking date expiry", () => {
		expect(() =>
			assertMutableCart(
				{
					expiresAt: new Date("2026-06-23T12:00:00.000Z"),
					id: "cart_1",
					status: "expired",
				},
				now,
			),
		).toThrow("This cart has expired.");
	});

	test("rejects expired carts", () => {
		expect(() =>
			assertMutableCart(
				{
					expiresAt: new Date("2026-06-22T11:59:59.000Z"),
					id: "cart_1",
					status: "draft",
				},
				now,
			),
		).toThrow(CommerceError);
	});
});

describe("toCartStatus", () => {
	test("rejects unexpected cart status values", () => {
		expect(() => toCartStatus("unknown")).toThrow("Unexpected cart status");
	});
});
