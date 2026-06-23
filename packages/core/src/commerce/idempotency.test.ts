import { describe, expect, test } from "bun:test";
import {
	canonicalJson,
	hashIdempotencyRequest,
	idempotencyExpiresAt,
} from "./idempotency";

describe("idempotency helpers", () => {
	test("hashes equivalent object keys identically", () => {
		const first = hashIdempotencyRequest({
			a: 1,
			b: { c: true, d: ["x", "y"] },
		});
		const second = hashIdempotencyRequest({
			b: { d: ["x", "y"], c: true },
			a: 1,
		});

		expect(first).toBe(second);
	});

	test("rejects undefined instead of colliding with literal sentinel strings", () => {
		expect(canonicalJson({ a: "__undefined__" })).toBe('{"a":"__undefined__"}');
		expect(() => canonicalJson({ a: undefined })).toThrow(TypeError);
	});

	test("rejects non-plain objects instead of hashing them like strings", () => {
		const instant = "2026-06-22T12:00:00.000Z";

		expect(canonicalJson({ at: instant })).toBe(`{"at":"${instant}"}`);
		expect(() => canonicalJson({ at: new Date(instant) })).toThrow(TypeError);
	});

	test("rejects circular payloads", () => {
		const payload: Record<string, unknown> = {};
		payload.self = payload;

		expect(() => canonicalJson(payload)).toThrow(TypeError);
	});

	test("expires idempotency records after one day", () => {
		const expiresAt = idempotencyExpiresAt(
			new Date("2026-06-22T12:00:00.000Z"),
		);

		expect(expiresAt.toISOString()).toBe("2026-06-23T12:00:00.000Z");
	});
});
