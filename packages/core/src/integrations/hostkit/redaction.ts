const REDACTED = "[REDACTED]";

/**
 * Hostkit authenticates with an `APIKEY` query parameter, so any logged URL or
 * provider error text can leak the key. Always pass error/log text through
 * here (with the key as a known secret) before it leaves the integration.
 */
export function redactHostkitText(
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
		/(APIKEY)\s*[:=]\s*["']?[^"'&,\s]+/gi,
		`$1=${REDACTED}`,
	);
}
