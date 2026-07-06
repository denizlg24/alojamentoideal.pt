const dateTimeFormat = new Intl.DateTimeFormat("en-GB", {
	dateStyle: "medium",
	timeStyle: "short",
});

const dateFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" });

const relativeFormat = new Intl.RelativeTimeFormat("en-GB", {
	numeric: "auto",
});

const RELATIVE_UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
	["day", 86_400_000],
	["hour", 3_600_000],
	["minute", 60_000],
	["second", 1_000],
];

export function formatMoneyMinor(minor: number, currency: string): string {
	const digits = new Intl.NumberFormat("en-GB", {
		currency,
		style: "currency",
	}).resolvedOptions().maximumFractionDigits;
	return new Intl.NumberFormat("en-GB", {
		currency,
		style: "currency",
	}).format(minor / 10 ** (digits ?? 1));
}

export function formatDateTime(value: Date | string): string {
	return dateTimeFormat.format(
		typeof value === "string" ? new Date(value) : value,
	);
}

export function formatDate(value: Date | string): string {
	return dateFormat.format(typeof value === "string" ? new Date(value) : value);
}

/** Human relative time ("in 3 hours", "2 days ago"); em dash when absent. */
export function formatRelative(
	value: Date | string | null | undefined,
): string {
	if (!value) {
		return "—";
	}
	const date = typeof value === "string" ? new Date(value) : value;
	const diffMs = date.getTime() - Date.now();
	for (const [unit, unitMs] of RELATIVE_UNITS) {
		if (Math.abs(diffMs) >= unitMs || unit === "second") {
			return relativeFormat.format(Math.round(diffMs / unitMs), unit);
		}
	}
	return "just now";
}
