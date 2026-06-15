const REDACTED = "[REDACTED]";

const SENSITIVE_KEYS = new Set([
	"access_code",
	"api_key",
	"authorization",
	"content_base64",
	"document_number",
	"lock_pin",
	"password",
	"pin",
	"rental_agreement_pdf",
	"signature",
	"signature_raw",
	"stripe_customer_id",
	"stripe_payment_method_id",
	"token",
	"x-api-key",
]);

export function redactHostifyValue(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(redactHostifyValue);
	}

	if (!isRecord(value)) {
		return value;
	}

	return Object.fromEntries(
		Object.entries(value).map(([key, child]) => [
			key,
			SENSITIVE_KEYS.has(key.toLowerCase())
				? REDACTED
				: redactHostifyValue(child),
		]),
	);
}

export function redactHostifyText(
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
		/(x-api-key|authorization|token)\s*[:=]\s*["']?[^"',\s]+/gi,
		`$1=${REDACTED}`,
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
