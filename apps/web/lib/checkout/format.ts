import { format } from "date-fns";
import { parseIsoDate } from "@/lib/catalog/dates";

/**
 * Currencies Stripe/ISO treat as zero-decimal. Mirrors `minorUnitFactor` in
 * `@workspace/core/commerce`; inlined here so this client-safe formatter never
 * pulls the server-coupled commerce barrel into the browser bundle.
 */
const ZERO_DECIMAL_CURRENCIES = new Set([
	"BIF",
	"CLP",
	"DJF",
	"GNF",
	"ISK",
	"JPY",
	"KMF",
	"KRW",
	"PYG",
	"RWF",
	"UGX",
	"UYI",
	"VND",
	"VUV",
	"XAF",
	"XOF",
	"XPF",
]);

function minorUnitFactor(currency: string): number {
	return ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? 1 : 100;
}

/** Formats a minor-unit amount (e.g. cents) as a localized currency string. */
export function formatMinor(amountMinor: number, currency: string): string {
	const factor = minorUnitFactor(currency);
	const fractionDigits = factor === 1 ? 0 : 2;
	return new Intl.NumberFormat("en", {
		currency,
		maximumFractionDigits: fractionDigits,
		minimumFractionDigits: fractionDigits,
		style: "currency",
	}).format(amountMinor / factor);
}

export function nightsLabel(nights: number): string {
	return `${nights} ${nights === 1 ? "night" : "nights"}`;
}

/** Compact stay range, e.g. "Jun 23-26" or "Jun 30 to Jul 2" across months. */
export function formatStayRange(checkIn: string, checkOut: string): string {
	const from = parseIsoDate(checkIn);
	const to = parseIsoDate(checkOut);
	if (
		from.getMonth() === to.getMonth() &&
		from.getFullYear() === to.getFullYear()
	) {
		return `${format(from, "MMM d")}-${format(to, "d")}`;
	}
	return `${format(from, "MMM d")} to ${format(to, "MMM d")}`;
}

/** Full stay range with year, e.g. "Jun 23 to Jun 26, 2026". */
export function formatStayRangeLong(checkIn: string, checkOut: string): string {
	const from = parseIsoDate(checkIn);
	const to = parseIsoDate(checkOut);
	return `${format(from, "MMM d")} to ${format(to, "MMM d, yyyy")}`;
}

/** Full single activity date with weekday, e.g. "Wed, Jun 24, 2026". */
export function formatActivityDateLong(date: string): string {
	return format(parseIsoDate(date), "EEE, MMM d, yyyy");
}

export interface GuestCounts {
	adults: number;
	children: number;
	infants: number;
}

export function guestSummaryLabel({
	adults,
	children,
	infants,
}: GuestCounts): string {
	const parts = [`${adults} ${adults === 1 ? "adult" : "adults"}`];
	if (children > 0) {
		parts.push(`${children} ${children === 1 ? "child" : "children"}`);
	}
	if (infants > 0) {
		parts.push(`${infants} ${infants === 1 ? "infant" : "infants"}`);
	}
	return parts.join(", ");
}
