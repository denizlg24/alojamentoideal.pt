import { describe, expect, test } from "bun:test";
import { CheckoutError, readCheckoutError, toCheckoutError } from "./errors";

// The web tsconfig exposes a minimal `expect` (toBe/toEqual only), so these
// assertions reduce to booleans rather than using richer matchers.
describe("readCheckoutError", () => {
	test("maps a known commerce code to friendly copy", async () => {
		const response = new Response(
			JSON.stringify({ code: "dates_unavailable", error: "raw" }),
			{ status: 409 },
		);
		const error = await readCheckoutError(response);
		expect(error instanceof CheckoutError).toBe(true);
		expect(error.code).toBe("dates_unavailable");
		expect(/no longer available/i.test(error.message)).toBe(true);
		expect(error.status).toBe(409);
	});

	test("falls back to the server error text for unknown codes", async () => {
		const response = new Response(
			JSON.stringify({ code: "weird_code", error: "Specific server message" }),
			{ status: 400 },
		);
		const error = await readCheckoutError(response);
		expect(error.message).toBe("Specific server message");
	});

	test("degrades gracefully when the body is not JSON", async () => {
		const response = new Response("not json", { status: 500 });
		const error = await readCheckoutError(response);
		expect(error.status).toBe(500);
		expect(error.message.length > 0).toBe(true);
	});

	test("cart_converted no longer dead-ends the guest", async () => {
		const response = new Response(JSON.stringify({ code: "cart_converted" }), {
			status: 409,
		});
		const error = await readCheckoutError(response);
		expect(error.code).toBe("cart_converted");
		// The copy must not imply someone else is already paying for the stay.
		expect(/already being paid/i.test(error.message)).toBe(false);
		expect(/payment step/i.test(error.message)).toBe(true);
	});
});

describe("toCheckoutError", () => {
	test("passes through existing CheckoutErrors", () => {
		const original = new CheckoutError({
			code: "x",
			message: "m",
			status: 400,
		});
		expect(toCheckoutError(original)).toBe(original);
	});

	test("treats thrown values as network errors", () => {
		const error = toCheckoutError(new TypeError("fetch failed"));
		expect(error.code).toBe("network_error");
		expect(error.status).toBe(0);
	});
});
