import type { HostifyClient } from "../integrations/hostify/index";
import type { QuoteRequest } from "./params";
import {
	type CacheOutcome,
	type JsonCacheClient,
	readThroughJsonCache,
} from "./redis-cache";

export interface AccommodationQuoteResult {
	available: boolean;
	cache: {
		outcome: CacheOutcome;
		ttlSeconds: number;
	};
	checkIn: string;
	checkOut: string;
	currency: string;
	expiresAt: string | null;
	fees: {
		cleaning: number | null;
		extraPerson: number | null;
	};
	fetchedAt: string;
	guests: number;
	listingId: string;
	nightlyAverage: number | null;
	nights: number;
	pets: number;
	symbol: string | null;
	total: number;
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

		return {
			available: price.available,
			checkIn: input.dates.checkIn,
			checkOut: input.dates.checkOut,
			currency: this.#currency,
			fees: {
				cleaning: price.cleaning_fee ?? null,
				extraPerson: price.extra_person_price ?? null,
			},
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
			total: price.total,
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
		input.pets,
	].join(":");
}

function expiresAt(fetchedAt: string, ttlSeconds: number): string | null {
	if (ttlSeconds <= 0) {
		return null;
	}

	return new Date(
		new Date(fetchedAt).getTime() + ttlSeconds * 1000,
	).toISOString();
}
