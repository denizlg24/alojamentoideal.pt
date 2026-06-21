import type { HostifyClient } from "../integrations/hostify/index";
import type { StayDates } from "./params";
import {
	type CacheOutcome,
	type JsonCacheClient,
	readThroughJsonCache,
} from "./redis-cache";

export interface AccommodationAvailabilityInput {
	accountId?: string;
	dates: StayDates;
	forceFresh?: boolean;
	guests: number;
	providerId?: string;
}

export interface AccommodationAvailabilityResult {
	availableListingIds: string[];
	cache: {
		outcome: CacheOutcome;
		ttlSeconds: number;
	};
	checkIn: string;
	checkOut: string;
	expiresAt: string | null;
	fetchedAt: string;
	guests: number;
	nights: number;
}

interface AccommodationAvailabilityServiceOptions {
	client: Pick<HostifyClient, "listings">;
	redis: JsonCacheClient;
	ttlSeconds: number;
}

interface CachedAvailability {
	availableListingIds: string[];
	checkIn: string;
	checkOut: string;
	fetchedAt: string;
	guests: number;
	nights: number;
}

export class AccommodationAvailabilityService {
	readonly #client: Pick<HostifyClient, "listings">;
	readonly #redis: AccommodationAvailabilityServiceOptions["redis"];
	readonly #ttlSeconds: number;

	constructor(options: AccommodationAvailabilityServiceOptions) {
		this.#client = options.client;
		this.#redis = options.redis;
		this.#ttlSeconds = options.ttlSeconds;
	}

	async check(
		input: AccommodationAvailabilityInput,
	): Promise<AccommodationAvailabilityResult> {
		const key = availabilityCacheKey(input);
		const result = await readThroughJsonCache(
			this.#redis,
			key,
			this.#ttlSeconds,
			input.forceFresh ?? false,
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

	private async fetchLive(
		input: AccommodationAvailabilityInput,
	): Promise<CachedAvailability> {
		const response = await this.#client.listings.listAvailable({
			end_date: input.dates.checkOut,
			guests: input.guests,
			start_date: input.dates.checkIn,
		});

		return {
			availableListingIds: response.listings.map((listing) =>
				String(listing.id),
			),
			checkIn: input.dates.checkIn,
			checkOut: input.dates.checkOut,
			fetchedAt: new Date().toISOString(),
			guests: input.guests,
			nights: input.dates.nights,
		};
	}
}

function availabilityCacheKey(input: AccommodationAvailabilityInput): string {
	return [
		"accommodation",
		"availability",
		"v1",
		input.providerId ?? "default",
		input.accountId ?? "default",
		input.dates.checkIn,
		input.dates.checkOut,
		input.guests,
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
