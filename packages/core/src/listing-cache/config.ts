export interface ListingCacheConfig {
	cronSecret?: string;
	hostifyAccountId: string;
	llmEnabled: boolean;
	openaiApiKey?: string;
	openaiModel: string;
	staleAfterHours: number;
	syncMaxPages: number;
	syncPerPage: number;
}

interface ListingCacheEnvironment {
	CRON_SECRET?: string;
	HOSTIFY_ACCOUNT_ID?: string;
	HOSTIFY_LISTING_SYNC_MAX_PAGES?: string;
	HOSTIFY_LISTING_SYNC_PER_PAGE?: string;
	HOSTIFY_LISTING_STALE_AFTER_HOURS?: string;
	HOSTIFY_SYNC_CRON_SECRET?: string;
	LISTING_LLM_ENABLED?: string;
	OPENAI_API_KEY?: string;
	OPENAI_LISTING_MODEL?: string;
}

export function getListingCacheConfig(
	environment: ListingCacheEnvironment = {
		CRON_SECRET: process.env.CRON_SECRET,
		HOSTIFY_ACCOUNT_ID: process.env.HOSTIFY_ACCOUNT_ID,
		HOSTIFY_LISTING_STALE_AFTER_HOURS:
			process.env.HOSTIFY_LISTING_STALE_AFTER_HOURS,
		HOSTIFY_LISTING_SYNC_MAX_PAGES: process.env.HOSTIFY_LISTING_SYNC_MAX_PAGES,
		HOSTIFY_LISTING_SYNC_PER_PAGE: process.env.HOSTIFY_LISTING_SYNC_PER_PAGE,
		HOSTIFY_SYNC_CRON_SECRET: process.env.HOSTIFY_SYNC_CRON_SECRET,
		LISTING_LLM_ENABLED: process.env.LISTING_LLM_ENABLED,
		OPENAI_API_KEY: process.env.OPENAI_API_KEY,
		OPENAI_LISTING_MODEL: process.env.OPENAI_LISTING_MODEL,
	},
): ListingCacheConfig {
	return {
		cronSecret: environment.HOSTIFY_SYNC_CRON_SECRET ?? environment.CRON_SECRET,
		hostifyAccountId: environment.HOSTIFY_ACCOUNT_ID ?? "default",
		llmEnabled: optionalBoolean(environment.LISTING_LLM_ENABLED) ?? true,
		openaiApiKey: environment.OPENAI_API_KEY,
		openaiModel: environment.OPENAI_LISTING_MODEL ?? "gpt-5.5",
		staleAfterHours: optionalInteger(
			"HOSTIFY_LISTING_STALE_AFTER_HOURS",
			environment.HOSTIFY_LISTING_STALE_AFTER_HOURS,
			1,
			24 * 30,
			24,
		),
		syncMaxPages: optionalInteger(
			"HOSTIFY_LISTING_SYNC_MAX_PAGES",
			environment.HOSTIFY_LISTING_SYNC_MAX_PAGES,
			1,
			500,
			50,
		),
		syncPerPage: optionalInteger(
			"HOSTIFY_LISTING_SYNC_PER_PAGE",
			environment.HOSTIFY_LISTING_SYNC_PER_PAGE,
			1,
			100,
			50,
		),
	};
}

function optionalBoolean(value: string | undefined): boolean | undefined {
	if (value === undefined) {
		return undefined;
	}

	return !["0", "false", "no", "off"].includes(value.toLowerCase());
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
