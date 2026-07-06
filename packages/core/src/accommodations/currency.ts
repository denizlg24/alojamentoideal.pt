const DEFAULT_CURRENCY_CODE = "EUR";
const ISO_CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;
const SYMBOL_CURRENCY_CODES = new Map<string, string>([["€", "EUR"]]);
const SUPPORTED_CURRENCY_CODES = new Set(Intl.supportedValuesOf("currency"));

export function normalizeCurrencyCode(
	value: string | null | undefined,
	fallback: string | null | undefined = DEFAULT_CURRENCY_CODE,
): string {
	for (const candidate of [value, fallback, DEFAULT_CURRENCY_CODE]) {
		const normalized = normalizeCurrencyCandidate(candidate);
		if (normalized) {
			return normalized;
		}
	}

	return DEFAULT_CURRENCY_CODE;
}

function normalizeCurrencyCandidate(
	value: string | null | undefined,
): string | null {
	const trimmed = value?.trim();
	if (!trimmed) {
		return null;
	}

	const symbolCode = SYMBOL_CURRENCY_CODES.get(trimmed);
	if (symbolCode) {
		return symbolCode;
	}

	const code = trimmed.toUpperCase();
	if (!ISO_CURRENCY_CODE_PATTERN.test(code)) {
		return null;
	}

	if (!SUPPORTED_CURRENCY_CODES.has(code)) {
		return null;
	}

	return code;
}
