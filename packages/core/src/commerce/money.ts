import type { AccommodationQuoteFeeSnapshot } from "@workspace/db";
import type { AccommodationQuoteResult } from "../accommodations";
import type { NormalizedAccommodationQuoteSnapshot } from "./types";

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
