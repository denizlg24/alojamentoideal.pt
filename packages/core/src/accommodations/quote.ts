import type {
	HostifyClient,
	HostifyListingPrice,
	HostifyListingPriceFee,
} from "../integrations/hostify/index";
import type { QuoteRequest } from "./params";
import {
	type CacheOutcome,
	type JsonCacheClient,
	readThroughJsonCache,
} from "./redis-cache";

/**
 * One displayable line of the live price breakdown. `isBasePrice` marks the
 * accommodation subtotal (rendered as nightly x nights, not as a separate fee);
 * every other line (cleaning, city/tourist tax, extras) is shown on its own row.
 * `inclusiveTax` is VAT already inside `total`; tax lines have `type === "tax"`.
 */
export interface AccommodationQuoteFee {
	adjustedForChildren: boolean;
	amount: number | null;
	chargeLabel: string | null;
	inclusiveTax: number | null;
	isBasePrice: boolean;
	name: string;
	originalTotal: number | null;
	quantity: number | null;
	total: number;
	type: string;
}

export interface AccommodationQuoteResult {
	adults: number;
	available: boolean;
	cache: {
		outcome: CacheOutcome;
		ttlSeconds: number;
	};
	checkIn: string;
	checkOut: string;
	children: number;
	cleaningFee: number | null;
	currency: string;
	expiresAt: string | null;
	/** Full breakdown straight from Hostify, including the base accommodation line. */
	fees: AccommodationQuoteFee[];
	fetchedAt: string;
	guests: number;
	listingId: string;
	nightlyAverage: number | null;
	nights: number;
	pets: number;
	symbol: string | null;
	/** Sum of every `type === "tax"` line (city tax, tourist tax). */
	taxTotal: number;
	total: number;
	/** VAT already baked into the line totals; for display only, not added again. */
	vatIncluded: number;
}

interface AccommodationQuoteServiceOptions {
	client: Pick<HostifyClient, "listings">;
	currency: string;
	redis: JsonCacheClient;
	ttlSeconds: number;
}

type CachedQuote = Omit<AccommodationQuoteResult, "cache" | "expiresAt">;

export class AccommodationQuoteService {
	readonly #client: Pick<HostifyClient, "listings">;
	readonly #currency: string;
	readonly #redis: AccommodationQuoteServiceOptions["redis"];
	readonly #ttlSeconds: number;

	constructor(options: AccommodationQuoteServiceOptions) {
		this.#client = options.client;
		this.#currency = options.currency;
		this.#redis = options.redis;
		this.#ttlSeconds = options.ttlSeconds;
	}

	async quote(input: QuoteRequest): Promise<AccommodationQuoteResult> {
		const result = await readThroughJsonCache(
			this.#redis,
			quoteCacheKey(input),
			this.#ttlSeconds,
			input.forceFresh,
			() => this.fetchLive(input),
		);

		return {
			...result.value,
			cache: {
				outcome: result.outcome,
				ttlSeconds: this.#ttlSeconds,
			},
			expiresAt: expiresAt(result.value.fetchedAt, this.#ttlSeconds),
		};
	}

	private async fetchLive(input: QuoteRequest): Promise<CachedQuote> {
		const response = await this.#client.listings.price({
			end_date: input.dates.checkOut,
			guests: input.guests,
			include_fees: 1,
			listing_id: input.listingId,
			pets: input.pets,
			start_date: input.dates.checkIn,
		});
		const price = response.price;
		const fees = buildFeeLines(price, input);
		const total = adjustedTotal(price.total, fees);

		return {
			adults: input.adults,
			available: price.available,
			checkIn: input.dates.checkIn,
			checkOut: input.dates.checkOut,
			children: input.children,
			cleaningFee: price.cleaning_fee ?? null,
			currency: this.#currency,
			fees,
			fetchedAt: new Date().toISOString(),
			guests: input.guests,
			listingId: input.listingId,
			nightlyAverage:
				input.dates.nights > 0
					? Math.round((price.price / input.dates.nights) * 100) / 100
					: null,
			nights: input.dates.nights,
			pets: input.pets,
			symbol: price.symbol ?? price.unicode ?? null,
			taxTotal: sumLines(fees, (fee) => fee.type === "tax"),
			total,
			vatIncluded:
				Math.round(
					fees.reduce((sum, fee) => sum + (fee.inclusiveTax ?? 0), 0) * 100,
				) / 100,
		};
	}
}

function quoteCacheKey(input: QuoteRequest): string {
	return [
		"accommodation",
		"quote",
		"v1",
		input.providerId ?? "default",
		input.accountId ?? "default",
		input.listingId,
		input.dates.checkIn,
		input.dates.checkOut,
		input.guests,
		input.adults,
		input.children,
		input.pets,
	].join(":");
}

function buildFeeLines(
	price: HostifyListingPrice,
	input: QuoteRequest,
): AccommodationQuoteFee[] {
	const lines = (Array.isArray(price.fees) ? price.fees : [])
		.map((fee) => toFeeLine(fee, input))
		.filter((line): line is AccommodationQuoteFee => line !== null);

	// Some listings keep the cleaning fee out of the breakdown array and only on
	// the top-level field; surface it as its own line so it is never dropped.
	const cleaning = price.cleaning_fee ?? 0;
	const hasCleaning = lines.some(
		(line) => line.type === "cleaning" || /clean/i.test(line.name),
	);
	if (!hasCleaning && cleaning > 0) {
		lines.push({
			adjustedForChildren: false,
			amount: cleaning,
			chargeLabel: null,
			inclusiveTax: null,
			isBasePrice: false,
			name: "Cleaning fee",
			originalTotal: null,
			quantity: null,
			total: cleaning,
			type: "fee",
		});
	}

	return lines;
}

function toFeeLine(
	fee: HostifyListingPriceFee,
	input: QuoteRequest,
): AccommodationQuoteFee | null {
	const total = fee.total ?? 0;
	const name = fee.fee_name ?? null;
	if (name === null && total === 0) {
		return null;
	}

	const line: AccommodationQuoteFee = {
		adjustedForChildren: false,
		amount: fee.amount ?? null,
		chargeLabel: fee.charge_type_label ?? null,
		inclusiveTax: fee.inclusive_tax ?? null,
		isBasePrice: fee.is_base_price === true,
		name: name ?? "Fee",
		originalTotal: null,
		quantity: fee.quantity ?? null,
		total,
		type: fee.fee_type ?? "fee",
	};

	return adjustAdultOnlyTax(line, input);
}

function adjustAdultOnlyTax(
	line: AccommodationQuoteFee,
	input: QuoteRequest,
): AccommodationQuoteFee {
	if (
		input.children <= 0 ||
		input.adults <= 0 ||
		line.amount === null ||
		line.amount <= 0 ||
		line.total <= 0 ||
		!isAdultOnlyTax(line)
	) {
		return line;
	}

	const adultQuantity = input.adults * input.dates.nights;
	if (adultQuantity <= 0) {
		return line;
	}

	const adjustedTotal = roundMoney(line.amount * adultQuantity);
	if (adjustedTotal >= line.total) {
		return line;
	}

	return {
		...line,
		adjustedForChildren: true,
		originalTotal: line.total,
		quantity: adultQuantity,
		total: adjustedTotal,
	};
}

function isAdultOnlyTax(line: AccommodationQuoteFee): boolean {
	if (line.type !== "tax") {
		return false;
	}

	const label = `${line.name} ${line.chargeLabel ?? ""}`.toLowerCase();
	if (/\b(vat|iva|sales tax|taxa de iva)\b/i.test(label)) {
		return false;
	}

	return /\b(tourist|tourism|city|municipal|occupancy|visitor|adult)\b/i.test(
		label,
	);
}

function adjustedTotal(
	providerTotal: number,
	lines: AccommodationQuoteFee[],
): number {
	const delta = lines.reduce((sum, line) => {
		if (!line.adjustedForChildren || line.originalTotal === null) {
			return sum;
		}
		return sum + (line.originalTotal - line.total);
	}, 0);

	return Math.max(0, roundMoney(providerTotal - delta));
}

function sumLines(
	lines: AccommodationQuoteFee[],
	predicate: (line: AccommodationQuoteFee) => boolean,
): number {
	const sum = lines
		.filter(predicate)
		.reduce((total, line) => total + line.total, 0);
	return roundMoney(sum);
}

function roundMoney(value: number): number {
	return Math.round(value * 100) / 100;
}

function expiresAt(fetchedAt: string, ttlSeconds: number): string | null {
	if (ttlSeconds <= 0) {
		return null;
	}

	return new Date(
		new Date(fetchedAt).getTime() + ttlSeconds * 1000,
	).toISOString();
}
