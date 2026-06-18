export function optionalString(value: string | undefined): string | undefined {
	if (value === undefined) {
		return undefined;
	}

	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

export function optionalBoolean(
	value: string | undefined,
): boolean | undefined {
	if (value === undefined) {
		return undefined;
	}

	return !["0", "false", "no", "off"].includes(value.trim().toLowerCase());
}

export function optionalInteger(
	name: string,
	value: string | undefined,
	min: number,
	max: number,
	defaultValue: number,
): number {
	if (value === undefined || value.trim().length === 0) {
		return defaultValue;
	}

	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
		throw new Error(`${name} must be an integer between ${min} and ${max}`);
	}

	return parsed;
}
