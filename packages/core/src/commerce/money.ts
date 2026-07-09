import type {
	AccommodationQuoteFeeSnapshot,
	ActivityBookingAnswerSnapshot,
	ActivityParticipantSnapshot,
} from "@workspace/db";
import type { AccommodationQuoteResult } from "../accommodations";
import type {
	NormalizedAccommodationQuoteSnapshot,
	NormalizedActivityQuoteSnapshot,
} from "./types";

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

export interface NormalizeQuoteSnapshotInput {
	accountId: string;
	provider: string;
	quote: AccommodationQuoteResult;
	quoteId?: string;
	ttlSeconds: number;
}

export function normalizeAccommodationQuoteSnapshot({
	accountId,
	provider,
	quote,
	quoteId = crypto.randomUUID(),
	ttlSeconds,
}: NormalizeQuoteSnapshotInput): NormalizedAccommodationQuoteSnapshot {
	const fetchedAt = new Date(quote.fetchedAt);
	const expiresAt = quote.expiresAt
		? new Date(quote.expiresAt)
		: new Date(fetchedAt.getTime() + Math.max(ttlSeconds, 0) * 1000);
	const totalMinor = toMinorUnits(quote.total, quote.currency);
	const taxMinor = toMinorUnits(quote.taxTotal, quote.currency);
	const feeLines = normalizeFeeLines(quote, totalMinor);

	return {
		adults: quote.adults,
		checkIn: quote.checkIn,
		checkOut: quote.checkOut,
		children: quote.children,
		cleaningFeeMinor: nullableMinorUnits(quote.cleaningFee, quote.currency),
		currency: quote.currency.toUpperCase(),
		expiresAt,
		externalAccountId: accountId,
		feeLines,
		fetchedAt,
		guests: quote.guests,
		housingFeeMinor: housingFeeMinor(feeLines),
		id: quoteId,
		infants: quote.infants,
		listingExternalId: quote.listingId,
		nightlyAverageMinor: nullableMinorUnits(
			quote.nightlyAverage,
			quote.currency,
		),
		nights: quote.nights,
		pets: quote.pets,
		provider,
		providerPayload: {
			available: quote.available,
			cache: quote.cache,
			symbol: quote.symbol,
			vatIncludedMinor: toMinorUnits(quote.vatIncluded, quote.currency),
		},
		subtotalMinor: Math.max(0, totalMinor - taxMinor),
		taxMinor,
		totalMinor,
		validationStatus: quote.available ? "valid" : "unavailable",
	};
}

export function toMinorUnits(value: number, currency: string): number {
	if (!Number.isFinite(value)) {
		throw new Error("Money value must be finite");
	}

	const factor = minorUnitFactor(currency);
	// Hostify supplies final decimal prices for checkout. At this boundary we
	// only normalize to integer minor units, so nearest-cent rounding is the
	// expected storage conversion rather than a tax or allocation calculation.
	return Math.round(value * factor);
}

export function nullableMinorUnits(
	value: number | null | undefined,
	currency: string,
): number | null {
	return value === null || value === undefined
		? null
		: toMinorUnits(value, currency);
}

export function minorUnitFactor(currency: string): number {
	return ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? 1 : 100;
}

/**
 * Net (tax-excluded) amount of a single fee line. Shared by draft-order charge
 * rows and the housing-base derivation so the two always agree. Inclusive tax
 * is stripped for non-tax lines; tax lines net to zero. Negative lines (e.g.
 * provider discounts) are preserved rather than clamped.
 */
export function feeLineNetMinor(
	line: AccommodationQuoteFeeSnapshot,
	isTaxLine: boolean,
): number {
	const taxMinor = isTaxLine ? line.totalMinor : (line.inclusiveTaxMinor ?? 0);
	const rawNetMinor = line.totalMinor - taxMinor;
	return line.totalMinor < 0 ? rawNetMinor : Math.max(0, rawNetMinor);
}

/**
 * Pre-tax housing base: the net of the base-price (`isBasePrice`) lines. This is
 * the only amount a discount may reduce (never fees or tax). Base-price lines
 * are never tax lines, so they net with `isTaxLine = false`.
 */
export function housingFeeMinor(
	feeLines: AccommodationQuoteFeeSnapshot[],
): number {
	return feeLines
		.filter((line) => line.isBasePrice)
		.reduce((sum, line) => sum + feeLineNetMinor(line, false), 0);
}

function normalizeFeeLines(
	quote: AccommodationQuoteResult,
	totalMinor: number,
): AccommodationQuoteFeeSnapshot[] {
	const currency = quote.currency;
	const lines: AccommodationQuoteFeeSnapshot[] = quote.fees.map((fee) => ({
		amountMinor: nullableMinorUnits(fee.amount, currency),
		chargeLabel: fee.chargeLabel,
		inclusiveTaxMinor: nullableMinorUnits(fee.inclusiveTax, currency),
		isBasePrice: fee.isBasePrice,
		name: fee.name,
		providerPayload: {
			chargeLabel: fee.chargeLabel,
			isBasePrice: fee.isBasePrice,
			type: fee.type,
		},
		quantity: fee.quantity,
		totalMinor: toMinorUnits(fee.total, currency),
		type: fee.type,
	}));

	if (!lines.some((line) => line.isBasePrice)) {
		const feeTotal = lines.reduce((sum, line) => sum + line.totalMinor, 0);
		lines.unshift({
			amountMinor: null,
			chargeLabel: "Stay",
			inclusiveTaxMinor: null,
			isBasePrice: true,
			name: "Accommodation",
			providerPayload: { synthesized: true, type: "accommodation" },
			quantity: quote.nights,
			totalMinor: Math.max(0, totalMinor - feeTotal),
			type: "accommodation",
		});
	}

	return lines;
}

/**
 * Raw activity price the injected `quoteActivity` adapter returns. Unlike the
 * accommodation quote (major-unit decimals converted here), the Bokun adapter
 * prices participant categories directly into minor units, so this boundary only
 * assigns identity/expiry/scope. `available: false` marks a sold-out departure.
 */
export interface ActivityQuoteResult {
	activityDate: string;
	answers: ActivityBookingAnswerSnapshot[];
	available: boolean;
	bokunActivityId: string;
	currency: string;
	expiresAt?: Date | string | null;
	fetchedAt: Date | string;
	participants: ActivityParticipantSnapshot[];
	providerPayload?: Record<string, unknown>;
	rateId: string | null;
	startTimeId: string | null;
	subtotalMinor: number;
	taxMinor: number;
	totalMinor: number;
	totalParticipants: number;
}

export interface NormalizeActivityQuoteSnapshotInput {
	accountId: string;
	provider: string;
	quote: ActivityQuoteResult;
	quoteId?: string;
	ttlSeconds: number;
}

export function normalizeActivityQuoteSnapshot({
	accountId,
	provider,
	quote,
	quoteId = crypto.randomUUID(),
	ttlSeconds,
}: NormalizeActivityQuoteSnapshotInput): NormalizedActivityQuoteSnapshot {
	const fetchedAt = new Date(quote.fetchedAt);
	const expiresAt = quote.expiresAt
		? new Date(quote.expiresAt)
		: new Date(fetchedAt.getTime() + Math.max(ttlSeconds, 0) * 1000);

	return {
		activityDate: quote.activityDate,
		answers: quote.answers,
		bokunActivityId: quote.bokunActivityId,
		currency: quote.currency.toUpperCase(),
		expiresAt,
		externalAccountId: accountId,
		fetchedAt,
		id: quoteId,
		participants: quote.participants,
		provider,
		providerPayload: quote.providerPayload ?? {},
		rateId: quote.rateId,
		startTimeId: quote.startTimeId,
		subtotalMinor: quote.subtotalMinor,
		taxMinor: quote.taxMinor,
		totalMinor: quote.totalMinor,
		totalParticipants: quote.totalParticipants,
		validationStatus: quote.available ? "valid" : "unavailable",
	};
}
