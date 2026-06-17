import { createHash } from "node:crypto";

const SENSITIVE_KEY_PATTERN =
	/(api[_-]?key|token|secret|password|passcode|access[_-]?code|lock[_-]?pin|wifi|wi-fi|wireless|keycode|door[_-]?code)/i;

export function stableHash(value: unknown): string {
	return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function stableStringify(value: unknown): string {
	return JSON.stringify(canonicalize(value));
}

export function sanitizeProviderPayload(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map((item) => sanitizeProviderPayload(item));
	}

	if (!isRecord(value)) {
		return value;
	}

	return Object.fromEntries(
		Object.entries(value)
			.filter(([key]) => !SENSITIVE_KEY_PATTERN.test(key))
			.map(([key, nested]) => [key, sanitizeProviderPayload(nested)]),
	);
}

function canonicalize(value: unknown): unknown {
	if (value === undefined) {
		return null;
	}

	if (value === null || typeof value !== "object") {
		return value;
	}

	if (value instanceof Date) {
		return value.toISOString();
	}

	if (Array.isArray(value)) {
		return value.map((item) => canonicalize(item));
	}

	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>)
			.filter(([, nested]) => nested !== undefined)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, nested]) => [key, canonicalize(nested)]),
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
