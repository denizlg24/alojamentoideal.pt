import type {
	PromotionCodeBlocker,
	PromotionDiscount,
} from "@workspace/core/integrations/stripe";
import type { DiscountScope } from "@workspace/db";
import { formatMoneyMinor } from "@/lib/format";
import type { AdminPromotionCode } from "@/lib/promotions";
import { PROMOTION_TIME_ZONE } from "@/lib/promotions/expiry";

export const SCOPE_LABELS: Record<DiscountScope, string> = {
	activities: "Activities",
	all: "Both",
	housing: "Homes",
};

export const SCOPE_OPTIONS = [
	{
		description:
			"Base price of stays. Cleaning fees and taxes are never discounted.",
		label: SCOPE_LABELS.housing,
		value: "housing",
	},
	{
		description: "Tour and activity prices.",
		label: SCOPE_LABELS.activities,
		value: "activities",
	},
	{
		description: "Homes and activities in the same cart.",
		label: SCOPE_LABELS.all,
		value: "all",
	},
] as const satisfies readonly {
	description: string;
	label: string;
	value: DiscountScope;
}[];

export const DEFAULT_SCOPE: DiscountScope = "all";

export function isDiscountScope(value: string): value is DiscountScope {
	return SCOPE_OPTIONS.some((option) => option.value === value);
}

const SCOPE_PHRASES: Record<DiscountScope, string> = {
	activities: "activities",
	all: "homes and activities",
	housing: "homes",
};

export function scopePhrase(scope: DiscountScope): string {
	return SCOPE_PHRASES[scope];
}

/** Store-facing code rule, mirrored from the server so errors show instantly. */
export const PROMOTION_CODE_RULE = /^[A-Z0-9-]{3,40}$/;

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generatePromotionCode(length = 8): string {
	const bytes = crypto.getRandomValues(new Uint8Array(length));
	return Array.from(
		bytes,
		(byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length],
	).join("");
}

/** Parses a typed amount the way the server does (comma or dot decimals). */
export function parseAmount(value: string): number | null {
	const trimmed = value.trim();
	if (!trimmed) {
		return null;
	}
	const amount = Number(trimmed.replace(",", "."));
	return Number.isFinite(amount) ? amount : null;
}

const percentFormat = new Intl.NumberFormat("en-GB", {
	maximumFractionDigits: 2,
});

export function formatPercent(percentOff: number): string {
	return `${percentFormat.format(percentOff)}%`;
}

export function formatMoneyMajor(amount: number, currency: string): string {
	return new Intl.NumberFormat("en-GB", { currency, style: "currency" }).format(
		amount,
	);
}

export function currencySymbol(currency: string): string {
	return (
		new Intl.NumberFormat("en-GB", { currency, style: "currency" })
			.formatToParts(0)
			.find((part) => part.type === "currency")?.value ?? currency
	);
}

export function formatDiscount(discount: PromotionDiscount | null): string {
	if (!discount) {
		return "Unknown";
	}
	return discount.type === "percentage"
		? formatPercent(discount.percentOff)
		: formatMoneyMinor(discount.amountMinor, discount.currency);
}

/**
 * Instants are shown as their Lisbon calendar day: expiries end at Lisbon
 * midnight, and a fixed zone keeps server and browser renders identical.
 */
const lisbonDateFormat = new Intl.DateTimeFormat("en-GB", {
	dateStyle: "medium",
	timeZone: PROMOTION_TIME_ZONE,
});

export function formatLisbonDate(iso: string): string {
	return lisbonDateFormat.format(new Date(iso));
}

/**
 * A listed code with its Intl-formatted labels. They are built on the server
 * so browser ICU data (for example "Sep" vs "Sept") cannot break hydration.
 */
export interface PromotionCodeView extends AdminPromotionCode {
	labels: { created: string; discount: string; expires: string | null };
}

export function toPromotionCodeView(
	code: AdminPromotionCode,
): PromotionCodeView {
	return {
		...code,
		labels: {
			created: formatLisbonDate(code.createdAt),
			discount: formatDiscount(code.discount),
			expires: code.expiresAt ? formatLisbonDate(code.expiresAt) : null,
		},
	};
}

const calendarDayFormat = new Intl.DateTimeFormat("en-GB", {
	dateStyle: "medium",
});

/** Formats a date picked in the calendar (local midnight of that day). */
export function formatCalendarDay(day: Date): string {
	return calendarDayFormat.format(day);
}

export function toIsoDay(day: Date): string {
	const month = String(day.getMonth() + 1).padStart(2, "0");
	const date = String(day.getDate()).padStart(2, "0");
	return `${day.getFullYear()}-${month}-${date}`;
}

/** Today in Lisbon as a local-midnight Date, the earliest pickable expiry. */
export function lisbonToday(): Date {
	const parts = new Intl.DateTimeFormat("en-GB", {
		day: "numeric",
		month: "numeric",
		timeZone: PROMOTION_TIME_ZONE,
		year: "numeric",
	}).formatToParts(new Date());
	const part = (type: Intl.DateTimeFormatPartTypes) =>
		Number(parts.find((entry) => entry.type === type)?.value);
	return new Date(part("year"), part("month") - 1, part("day"));
}

export const BLOCKER_REASONS: Record<PromotionCodeBlocker, string> = {
	coupon_unavailable: "The Stripe coupon was deleted or is no longer valid.",
	customer_restricted:
		"Limited to a single Stripe customer, which checkout cannot check.",
	expired: "Past its expiry date.",
	first_time_only:
		"Uses Stripe's first-order-only rule, which checkout cannot check.",
	minimum_amount:
		"Uses a Stripe minimum order amount, which checkout cannot check.",
	product_restricted:
		"The coupon is limited to Stripe products; checkout does not use Stripe products.",
	redemption_limit:
		"Has a Stripe redemption limit, which checkout cannot enforce. Create a code without one.",
	unknown_scope:
		"Its restriction is unreadable. Pick Homes, Activities or Both to fix it.",
	unsupported_code: "Contains characters guests cannot enter at checkout.",
};

export type PromotionStatus = "active" | "blocked" | "expired" | "inactive";

export const STATUS_LABELS: Record<PromotionStatus, string> = {
	active: "Active",
	blocked: "Not usable at checkout",
	expired: "Expired",
	inactive: "Inactive",
};

export interface PromotionHealth {
	reasons: string[];
	status: PromotionStatus;
}

/**
 * Status shown for a code. `scope` and `active` may be optimistic, so an
 * unreadable scope stops counting as a problem once a new one is picked.
 */
export function promotionHealth(
	code: Pick<AdminPromotionCode, "active" | "blockers" | "discount" | "scope">,
	storeCurrency: string,
): PromotionHealth {
	const reasons = code.blockers
		.filter((blocker) => !(blocker === "unknown_scope" && code.scope !== null))
		.map((blocker) => BLOCKER_REASONS[blocker]);
	if (
		code.discount?.type === "fixed" &&
		code.discount.currency !== storeCurrency
	) {
		reasons.push(
			`Fixed amount is in ${code.discount.currency}; checkout charges in ${storeCurrency}.`,
		);
	}

	const status: PromotionStatus = code.blockers.includes("expired")
		? "expired"
		: !code.active
			? "inactive"
			: reasons.length > 0
				? "blocked"
				: "active";
	return { reasons, status };
}

export const PROMOTION_FILTERS = [
	{ label: "Active", value: "active" },
	{ label: "Inactive", value: "inactive" },
	{ label: "All", value: "all" },
] as const;

export type PromotionFilter = (typeof PROMOTION_FILTERS)[number]["value"];

export function isPromotionFilter(value: string): value is PromotionFilter {
	return PROMOTION_FILTERS.some((filter) => filter.value === value);
}

/** Expired codes can never be used again, so they sit with the inactive ones. */
export function matchesFilter(
	status: PromotionStatus,
	filter: PromotionFilter,
): boolean {
	if (filter === "all") {
		return true;
	}
	const live = status === "active" || status === "blocked";
	return filter === "active" ? live : !live;
}
