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
		return '"__undefined__"';
	}

	if (value === null || typeof value !== "object") {
		return JSON.stringify(value);
	}

	if (Array.isArray(value)) {
		if (seen.has(value)) {
			throw new TypeError("Cannot canonicalize circular idempotency payload");
		}
		seen.add(value);
		const result = `[${value
			.map((item) => canonicalJsonValue(item, seen))
			.join(",")}]`;
		seen.delete(value);
		return result;
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
