import { describe, expect, it } from "bun:test";
import { redactHostifyText, redactHostifyValue } from "./redaction";

describe("Hostify redaction", () => {
	it("redacts nested sensitive values without mutating safe values", () => {
		expect(
			redactHostifyValue({
				access_code: "1234",
				guest: {
					document_number: "AB123",
					name: "Maria",
				},
				listing_id: 10,
			}),
		).toEqual({
			access_code: "[REDACTED]",
			guest: {
				document_number: "[REDACTED]",
				name: "Maria",
			},
			listing_id: 10,
		});
	});

	it("redacts configured secrets and credential-like text", () => {
		expect(
			redactHostifyText("x-api-key: secret-key token=abc", ["secret-key"]),
		).toBe("x-api-key=[REDACTED] token=[REDACTED]");
	});
});
