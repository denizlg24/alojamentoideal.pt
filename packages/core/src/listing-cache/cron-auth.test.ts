import { describe, expect, it } from "bun:test";
import { isAuthorizedCronRequest } from "./cron-auth";

const SECRET = "super-secret-cron-token";

function request(headers: Record<string, string>): Request {
	return new Request("https://example.com/api/cron/hostify/listings", {
		headers,
	});
}

describe("isAuthorizedCronRequest", () => {
	it("rejects requests without a secret", () => {
		expect(isAuthorizedCronRequest(request({}), SECRET)).toBe(false);
	});

	it("accepts a matching Authorization bearer token", () => {
		expect(
			isAuthorizedCronRequest(
				request({ authorization: `Bearer ${SECRET}` }),
				SECRET,
			),
		).toBe(true);
	});

	it("accepts a matching x-cron-secret header", () => {
		expect(
			isAuthorizedCronRequest(request({ "x-cron-secret": SECRET }), SECRET),
		).toBe(true);
	});

	it("rejects a mismatched secret", () => {
		expect(
			isAuthorizedCronRequest(
				request({ authorization: "Bearer wrong" }),
				SECRET,
			),
		).toBe(false);
	});
});
