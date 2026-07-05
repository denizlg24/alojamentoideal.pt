export interface ListingCacheConfig {
	cronSecret?: string;
	hostifyAccountId: string;
	incrementalBatchSize: number;
	incrementalLeaseMinutes: number;
	incrementalSyncIntervalHours: number;
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
	HOSTIFY_LISTING_INCREMENTAL_BATCH_SIZE?: string;
	HOSTIFY_LISTING_SYNC_INTERVAL_HOURS?: string;
	HOSTIFY_LISTING_SYNC_LEASE_MINUTES?: string;
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
		HOSTIFY_LISTING_INCREMENTAL_BATCH_SIZE:
			process.env.HOSTIFY_LISTING_INCREMENTAL_BATCH_SIZE,
		HOSTIFY_LISTING_SYNC_INTERVAL_HOURS:
			process.env.HOSTIFY_LISTING_SYNC_INTERVAL_HOURS,
		HOSTIFY_LISTING_SYNC_LEASE_MINUTES:
			process.env.HOSTIFY_LISTING_SYNC_LEASE_MINUTES,
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
		incrementalBatchSize: optionalInteger(
			"HOSTIFY_LISTING_INCREMENTAL_BATCH_SIZE",
			environment.HOSTIFY_LISTING_INCREMENTAL_BATCH_SIZE,
			1,
			100,
			10,
		),
		incrementalLeaseMinutes: optionalInteger(
			"HOSTIFY_LISTING_SYNC_LEASE_MINUTES",
			environment.HOSTIFY_LISTING_SYNC_LEASE_MINUTES,
			1,
			120,
			10,
		),
		incrementalSyncIntervalHours: optionalInteger(
			"HOSTIFY_LISTING_SYNC_INTERVAL_HOURS",
			environment.HOSTIFY_LISTING_SYNC_INTERVAL_HOURS,
			1,
			24 * 30,
			24,
		),
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

export async function getListingCacheConfigFromSettings(): Promise<ListingCacheConfig> {
	const settings = await getRuntimeSettings();
	return getListingCacheConfig({
		CRON_SECRET: process.env.CRON_SECRET,
		HOSTIFY_ACCOUNT_ID: String(settings["hostify.accountId"]),
		HOSTIFY_LISTING_INCREMENTAL_BATCH_SIZE: String(
			settings["hostify.listingIncrementalBatchSize"],
		),
		HOSTIFY_LISTING_SYNC_INTERVAL_HOURS: String(
			settings["hostify.listingSyncIntervalHours"],
		),
		HOSTIFY_LISTING_SYNC_LEASE_MINUTES: String(
			settings["hostify.listingSyncLeaseMinutes"],
		),
		HOSTIFY_LISTING_STALE_AFTER_HOURS: String(
			settings["hostify.listingStaleAfterHours"],
		),
		HOSTIFY_LISTING_SYNC_MAX_PAGES: String(
			settings["hostify.listingSyncMaxPages"],
		),
		HOSTIFY_LISTING_SYNC_PER_PAGE: String(
			settings["hostify.listingSyncPerPage"],
		),
		HOSTIFY_SYNC_CRON_SECRET: process.env.HOSTIFY_SYNC_CRON_SECRET,
		LISTING_LLM_ENABLED: String(settings["features.listingLlmEnabled"]),
		OPENAI_API_KEY: process.env.OPENAI_API_KEY,
		OPENAI_LISTING_MODEL: String(settings["listing.openaiModel"]),
	});
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

import { getRuntimeSettings } from "../settings";
