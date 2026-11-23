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
	amount: number | null;
	chargeLabel: string | null;
	inclusiveTax: number | null;
	isBasePrice: boolean;
	name: string;
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
	infants: number;
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
		const fees = buildFeeLines(price, input.dates.nights);
		const taxTotal = sumLines(fees, isTaxLine);
		const providerTaxTotal = roundMoney(
			(price.fees ?? [])
				.filter((fee) => fee.fee_type === "tax")
				.reduce((sum, fee) => sum + (fee.total ?? 0), 0),
		);
		// Hostify's `total` still includes the uncapped tax; take the waived part off.
		const total = roundMoney(price.total - (providerTaxTotal - taxTotal));

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
			infants: input.infants,
			listingId: input.listingId,
			nightlyAverage:
				input.dates.nights > 0
					? Math.round((price.price / input.dates.nights) * 100) / 100
					: null,
			nights: input.dates.nights,
			pets: input.pets,
			symbol: price.symbol ?? price.unicode ?? null,
			taxTotal,
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
		"v2",
		input.providerId ?? "default",
		input.accountId ?? "default",
		input.listingId,
		input.dates.checkIn,
		input.dates.checkOut,
		input.guests,
		input.adults,
		input.children,
		input.infants,
		input.pets,
	].join(":");
}

function buildFeeLines(
	price: HostifyListingPrice,
	nights: number,
): AccommodationQuoteFee[] {
	const lines = (Array.isArray(price.fees) ? price.fees : [])
		.map((fee) => toFeeLine(fee, nights))
		.filter((line): line is AccommodationQuoteFee => line !== null);

	// Some listings keep the cleaning fee out of the breakdown array and only on
	// the top-level field; surface it as its own line so it is never dropped.
	const cleaning = price.cleaning_fee ?? 0;
	const hasCleaning = lines.some(
		(line) => line.type === "cleaning" || /clean/i.test(line.name),
	);
	if (!hasCleaning && cleaning > 0) {
		lines.push({
			amount: cleaning,
			chargeLabel: null,
			inclusiveTax: null,
			isBasePrice: false,
			name: "Cleaning fee",
			quantity: null,
			total: cleaning,
			type: "cleaning",
		});
	}

	return lines;
}

function toFeeLine(
	fee: HostifyListingPriceFee,
	nights: number,
): AccommodationQuoteFee | null {
	const total = fee.total ?? 0;
	const name = fee.fee_name ?? null;
	if (name === null && total === 0) {
		return null;
	}

	const line: AccommodationQuoteFee = {
		amount: fee.amount ?? null,
		chargeLabel: replaceAdultWording(fee.charge_type_label ?? null),
		inclusiveTax: fee.inclusive_tax ?? null,
		isBasePrice: fee.is_base_price === true,
		name: replaceAdultWording(name) ?? "Fee",
		quantity: fee.quantity ?? null,
		total,
		type: fee.fee_type ?? "fee",
	};

	return isUncappedNightlyTax(fee) ? capNightlyTax(line, nights) : line;
}

/** Municipal tourist tax is only charged for the first nights of a stay. */
export const MUNICIPAL_TAX_MAX_NIGHTS = 7;

/**
 * Hostify bills the "City Tax" line `Per Adult / Night` across the whole stay
 * with no `cap_length`. A fee that already carries a Hostify cap is left alone
 * so the two caps never stack.
 */
function isUncappedNightlyTax(fee: HostifyListingPriceFee): boolean {
	const basis = `${fee.fee_charge_type ?? ""} ${fee.charge_type_label ?? ""}`;
	return (
		fee.fee_type === "tax" && (fee.cap_length ?? 0) <= 0 && /night/i.test(basis)
	);
}

function capNightlyTax(
	line: AccommodationQuoteFee,
	nights: number,
): AccommodationQuoteFee {
	if (nights <= MUNICIPAL_TAX_MAX_NIGHTS) {
		return line;
	}

	const ratio = MUNICIPAL_TAX_MAX_NIGHTS / nights;
	return {
		...line,
		inclusiveTax:
			line.inclusiveTax === null ? null : roundMoney(line.inclusiveTax * ratio),
		quantity: line.quantity === null ? null : roundMoney(line.quantity * ratio),
		total: roundMoney(line.total * ratio),
	};
}

function isTaxLine(line: AccommodationQuoteFee): boolean {
	return line.type === "tax";
}

/**
 * Taxes are charged for every guest (adults and children alike), so any
 * provider-sourced "per adult" wording is rewritten to "guest" for display.
 */
function replaceAdultWording<T extends string | null>(value: T): T {
	if (value === null) {
		return value;
	}
	return value
		.replace(/adults/gi, (match) => matchCase(match, "guests"))
		.replace(/adult/gi, (match) => matchCase(match, "guest")) as T;
}

function matchCase(source: string, replacement: string): string {
	if (source === source.toUpperCase()) {
		return replacement.toUpperCase();
	}
	if (source[0] === source[0]?.toUpperCase()) {
		return replacement[0]?.toUpperCase() + replacement.slice(1);
	}
	return replacement;
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
