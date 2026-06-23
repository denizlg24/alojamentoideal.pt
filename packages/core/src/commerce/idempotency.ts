import { createHash } from "node:crypto";

export const IDEMPOTENCY_KEY_TTL_MS = 24 * 60 * 60 * 1000;

export function hashIdempotencyRequest(payload: unknown): string {
	return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

export function idempotencyExpiresAt(now: Date): Date {
	return new Date(now.getTime() + IDEMPOTENCY_KEY_TTL_MS);
}

export function canonicalJson(value: unknown): string {
	return canonicalJsonValue(value, new WeakSet<object>());
}

function canonicalJsonValue(value: unknown, seen: WeakSet<object>): string {
	if (value === undefined) {
		throw new TypeError(
			"Idempotency payload must be JSON-serializable; undefined is not allowed",
		);
	}

	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "boolean"
	) {
		return JSON.stringify(value);
	}

	if (typeof value === "number") {
		if (!Number.isFinite(value)) {
			throw new TypeError(
				"Idempotency payload must be JSON-serializable; non-finite numbers are not allowed",
			);
		}
		return JSON.stringify(value);
	}

	if (typeof value !== "object") {
		throw new TypeError(
			"Idempotency payload must be JSON-serializable; unsupported values are not allowed",
		);
	}

	if (Array.isArray(value)) {
		if (seen.has(value)) {
			throw new TypeError("Cannot canonicalize circular idempotency payload");
		}
		seen.add(value);
		const result = `[${Array.from(value, (item) =>
			canonicalJsonValue(item, seen),
		).join(",")}]`;
		seen.delete(value);
		return result;
	}

	const proto = Object.getPrototypeOf(value);
	if (proto !== Object.prototype && proto !== null) {
		throw new TypeError(
			"Idempotency payload must contain only plain objects and arrays",
		);
	}

	if (Object.getOwnPropertySymbols(value).length > 0) {
		throw new TypeError(
			"Idempotency payload must use string-keyed plain objects",
		);
	}

	const record = value as Record<string, unknown>;
	if (seen.has(record)) {
		throw new TypeError("Cannot canonicalize circular idempotency payload");
	}
	seen.add(record);
	const result = `{${Object.keys(record)
		.sort()
		.map(
			(key) =>
				`${JSON.stringify(key)}:${canonicalJsonValue(record[key], seen)}`,
		)
		.join(",")}}`;
	seen.delete(record);
	return result;
}
