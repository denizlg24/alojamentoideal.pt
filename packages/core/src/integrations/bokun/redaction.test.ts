import { describe, expect, it } from "bun:test";
import { redactBokunText, redactBokunValue } from "./redaction";

describe("redactBokunValue", () => {
	it("redacts sensitive keys recursively", () => {
		const redacted = redactBokunValue({
			"access-key": "abc",
			customer: { passportId: "X1234", firstName: "Ana" },
			items: [{ "secret-key": "shh", title: "Tour" }],
		});

		expect(redacted).toEqual({
			"access-key": "[REDACTED]",
			customer: { passportId: "[REDACTED]", firstName: "Ana" },
			items: [{ "secret-key": "[REDACTED]", title: "Tour" }],
		});
	});
});

describe("redactBokunText", () => {
	it("masks provided secrets and credential-like patterns", () => {
		const text = "secret-key=topsecret failed for token shh";
		expect(redactBokunText(text, ["shh"])).toBe(
			"secret-key=[REDACTED] failed for token [REDACTED]",
		);
	});
});
