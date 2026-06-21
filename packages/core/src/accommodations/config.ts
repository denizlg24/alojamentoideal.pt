export interface AccommodationsConfig {
	availabilityCacheTtlSeconds: number;
	cronSecret?: string;
	currency: string;
	hostifyAccountId: string;
	liveSearchCandidateLimit: number;
	nightlyPriceSyncDays: number;
	nightlyPriceSyncMaxListings: number;
	quoteCacheTtlSeconds: number;
}

interface AccommodationsEnvironment {
	ACCOMMODATION_AVAILABILITY_CACHE_TTL_SECONDS?: string;
	ACCOMMODATION_CURRENCY?: string;
	ACCOMMODATION_LIVE_SEARCH_CANDIDATE_LIMIT?: string;
	ACCOMMODATION_NIGHTLY_PRICE_SYNC_DAYS?: string;
	ACCOMMODATION_NIGHTLY_PRICE_SYNC_MAX_LISTINGS?: string;
	ACCOMMODATION_QUOTE_CACHE_TTL_SECONDS?: string;
	CRON_SECRET?: string;
	HOSTIFY_ACCOUNT_ID?: string;
	HOSTIFY_SYNC_CRON_SECRET?: string;
}

export function getAccommodationsConfig(
	environment: AccommodationsEnvironment = {
		ACCOMMODATION_AVAILABILITY_CACHE_TTL_SECONDS:
			process.env.ACCOMMODATION_AVAILABILITY_CACHE_TTL_SECONDS,
		ACCOMMODATION_CURRENCY: process.env.ACCOMMODATION_CURRENCY,
		ACCOMMODATION_LIVE_SEARCH_CANDIDATE_LIMIT:
			process.env.ACCOMMODATION_LIVE_SEARCH_CANDIDATE_LIMIT,
		ACCOMMODATION_NIGHTLY_PRICE_SYNC_DAYS:
			process.env.ACCOMMODATION_NIGHTLY_PRICE_SYNC_DAYS,
		ACCOMMODATION_NIGHTLY_PRICE_SYNC_MAX_LISTINGS:
			process.env.ACCOMMODATION_NIGHTLY_PRICE_SYNC_MAX_LISTINGS,
		ACCOMMODATION_QUOTE_CACHE_TTL_SECONDS:
			process.env.ACCOMMODATION_QUOTE_CACHE_TTL_SECONDS,
		CRON_SECRET: process.env.CRON_SECRET,
		HOSTIFY_ACCOUNT_ID: process.env.HOSTIFY_ACCOUNT_ID,
		HOSTIFY_SYNC_CRON_SECRET: process.env.HOSTIFY_SYNC_CRON_SECRET,
	},
): AccommodationsConfig {
	return {
		availabilityCacheTtlSeconds: optionalInteger(
			"ACCOMMODATION_AVAILABILITY_CACHE_TTL_SECONDS",
			environment.ACCOMMODATION_AVAILABILITY_CACHE_TTL_SECONDS,
			0,
			3600,
			60,
		),
		cronSecret: environment.HOSTIFY_SYNC_CRON_SECRET ?? environment.CRON_SECRET,
		currency: environment.ACCOMMODATION_CURRENCY ?? "EUR",
		hostifyAccountId: environment.HOSTIFY_ACCOUNT_ID ?? "default",
		liveSearchCandidateLimit: optionalInteger(
			"ACCOMMODATION_LIVE_SEARCH_CANDIDATE_LIMIT",
			environment.ACCOMMODATION_LIVE_SEARCH_CANDIDATE_LIMIT,
			1,
			500,
			100,
		),
		nightlyPriceSyncDays: optionalInteger(
			"ACCOMMODATION_NIGHTLY_PRICE_SYNC_DAYS",
			environment.ACCOMMODATION_NIGHTLY_PRICE_SYNC_DAYS,
			1,
			730,
			540,
		),
		nightlyPriceSyncMaxListings: optionalInteger(
			"ACCOMMODATION_NIGHTLY_PRICE_SYNC_MAX_LISTINGS",
			environment.ACCOMMODATION_NIGHTLY_PRICE_SYNC_MAX_LISTINGS,
			1,
			500,
			100,
		),
		quoteCacheTtlSeconds: optionalInteger(
			"ACCOMMODATION_QUOTE_CACHE_TTL_SECONDS",
			environment.ACCOMMODATION_QUOTE_CACHE_TTL_SECONDS,
			0,
			3600,
			300,
		),
	};
}

function optionalInteger(
	name: string,
	value: string | undefined,
	min: number,
	max: number,
	defaultValue: number,
): number {
	if (value === undefined) {
		return defaultValue;
	}

	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
		throw new Error(`${name} must be an integer between ${min} and ${max}`);
	}

	return parsed;
}
