import { describe, expect, it } from "bun:test";
import { createHmac } from "node:crypto";
import { formatBokunDate, signBokunRequest } from "./auth.js";

describe("formatBokunDate", () => {
	it("formats dates as UTC yyyy-MM-dd HH:mm:ss", () => {
		const date = new Date(Date.UTC(2026, 5, 17, 9, 4, 5));
		expect(formatBokunDate(date)).toBe("2026-06-17 09:04:05");
	});
});

describe("signBokunRequest", () => {
	const accessKey = "access-key-value";
	const secretKey = "secret-key-value";
	const date = new Date(Date.UTC(2026, 5, 17, 9, 4, 5));

	it("signs over date + accessKey + method + path with HMAC-SHA1", () => {
		const headers = signBokunRequest({
			accessKey,
			date,
			method: "get",
			path: "/activity.json/42?lang=EN",
			secretKey,
		});

		const message = `2026-06-17 09:04:05${accessKey}GET/activity.json/42?lang=EN`;
		const expected = createHmac("sha1", secretKey)
			.update(message, "utf8")
			.digest("base64");

		expect(headers["X-Bokun-AccessKey"]).toBe(accessKey);
		expect(headers["X-Bokun-Date"]).toBe("2026-06-17 09:04:05");
		expect(headers["X-Bokun-Signature"]).toBe(expected);
	});

	it("uppercases the method in the signed message", () => {
		const lower = signBokunRequest({
			accessKey,
			date,
			method: "post",
			path: "/x",
			secretKey,
		});
		const upper = signBokunRequest({
			accessKey,
			date,
			method: "POST",
			path: "/x",
			secretKey,
		});

		expect(lower["X-Bokun-Signature"]).toBe(upper["X-Bokun-Signature"]);
	});

	it("never returns the secret key in the headers", () => {
		const headers = signBokunRequest({
			accessKey,
			date,
			method: "GET",
			path: "/x",
			secretKey,
		});

		expect(JSON.stringify(headers)).not.toContain(secretKey);
	});
});
