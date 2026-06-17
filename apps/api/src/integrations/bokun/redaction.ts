const REDACTED = "[REDACTED]";

const SENSITIVE_KEYS = new Set([
	"access-key",
	"accesskey",
	"authorization",
	"card_number",
	"cardnumber",
	"cvc",
	"cvv",
	"passportid",
	"password",
	"secret-key",
	"secretkey",
	"signature",
	"x-bokun-accesskey",
	"x-bokun-signature",
]);

export function redactBokunValue(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(redactBokunValue);
	}

	if (!isRecord(value)) {
		return value;
	}

	return Object.fromEntries(
		Object.entries(value).map(([key, child]) => [
			key,
			SENSITIVE_KEYS.has(key.toLowerCase())
				? REDACTED
				: redactBokunValue(child),
		]),
	);
}

export function redactBokunText(
	value: string,
	secrets: readonly string[] = [],
): string {
	let redacted = value;

	for (const secret of secrets) {
		if (secret) {
			redacted = redacted.replaceAll(secret, REDACTED);
		}
	}

	return redacted.replace(
		/(access-key|secret-key|x-bokun-signature|authorization)\s*[:=]\s*["']?[^"',\s]+/gi,
		`$1=${REDACTED}`,
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
