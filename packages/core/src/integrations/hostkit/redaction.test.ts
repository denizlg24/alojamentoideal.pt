import { describe, expect, it } from "bun:test";
import { redactHostkitText } from "./redaction";

describe("redactHostkitText", () => {
	it("redacts known secrets", () => {
		expect(redactHostkitText("failed calling key abc123", ["abc123"])).toBe(
			"failed calling key [REDACTED]",
		);
	});

	it("redacts APIKEY query parameters embedded in URLs", () => {
		const url = "https://app.hostkit.pt/api/addGuest?APIKEY=topsecret&rcode=X";
		const redacted = redactHostkitText(url);
		expect(redacted).not.toContain("topsecret");
		expect(redacted).toContain("rcode=X");
	});

	it("leaves unrelated text untouched", () => {
		expect(redactHostkitText("Unknown reservation code")).toBe(
			"Unknown reservation code",
		);
	});
});
