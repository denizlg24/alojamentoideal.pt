import { describe, expect, test } from "bun:test";
import { isOrderAccessGranted } from "./service";

describe("isOrderAccessGranted", () => {
	test("grants the linked user and denies everyone else", () => {
		const order = { cartToken: "tok", userId: "user_1" };
		expect(
			isOrderAccessGranted(order, { cartToken: null, userId: "user_1" }),
		).toBe(true);
		expect(
			isOrderAccessGranted(order, { cartToken: null, userId: "user_2" }),
		).toBe(false);
		// Anonymous caller cannot reach a user-linked order even with the token.
		expect(
			isOrderAccessGranted(order, { cartToken: "tok", userId: null }),
		).toBe(false);
	});

	test("grants an anonymous order only on a matching secret token", () => {
		const order = { cartToken: "secret-token", userId: null };
		expect(
			isOrderAccessGranted(order, { cartToken: "secret-token", userId: null }),
		).toBe(true);
		expect(
			isOrderAccessGranted(order, { cartToken: "other-token", userId: null }),
		).toBe(false);
		expect(isOrderAccessGranted(order, { cartToken: null, userId: null })).toBe(
			false,
		);
	});

	test("denies when the order has no originating cart token", () => {
		expect(
			isOrderAccessGranted(
				{ cartToken: null, userId: null },
				{ cartToken: "anything", userId: null },
			),
		).toBe(false);
	});
});
