import { describe, expect, test } from "bun:test";
import { isCartAccessGranted } from "./service";

const TOKEN = "11111111-1111-4111-8111-111111111111";
const OTHER_TOKEN = "22222222-2222-4222-8222-222222222222";

describe("isCartAccessGranted", () => {
	test("grants the linked user access to their cart", () => {
		expect(
			isCartAccessGranted(
				{ cartToken: TOKEN, userId: "user_1" },
				{ cartToken: null, userId: "user_1" },
			),
		).toBe(true);
	});

	test("denies a different user access to a linked cart", () => {
		expect(
			isCartAccessGranted(
				{ cartToken: TOKEN, userId: "user_1" },
				{ cartToken: TOKEN, userId: "user_2" },
			),
		).toBe(false);
	});

	test("denies an anonymous caller access to a linked cart even with the token", () => {
		expect(
			isCartAccessGranted(
				{ cartToken: TOKEN, userId: "user_1" },
				{ cartToken: TOKEN, userId: null },
			),
		).toBe(false);
	});

	test("grants an anonymous cart to a matching token", () => {
		expect(
			isCartAccessGranted(
				{ cartToken: TOKEN, userId: null },
				{ cartToken: TOKEN, userId: null },
			),
		).toBe(true);
	});

	test("denies an anonymous cart to a mismatched token", () => {
		expect(
			isCartAccessGranted(
				{ cartToken: TOKEN, userId: null },
				{ cartToken: OTHER_TOKEN, userId: null },
			),
		).toBe(false);
	});

	test("denies an anonymous cart when no token is presented", () => {
		expect(
			isCartAccessGranted(
				{ cartToken: TOKEN, userId: null },
				{ cartToken: null, userId: null },
			),
		).toBe(false);
	});

	test("grants an authenticated caller holding the matching token of an anonymous cart", () => {
		expect(
			isCartAccessGranted(
				{ cartToken: TOKEN, userId: null },
				{ cartToken: TOKEN, userId: "user_1" },
			),
		).toBe(true);
	});
});
