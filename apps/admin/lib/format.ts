const dateTimeFormat = new Intl.DateTimeFormat("en-GB", {
	dateStyle: "medium",
	timeStyle: "short",
});

const dateFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" });

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
