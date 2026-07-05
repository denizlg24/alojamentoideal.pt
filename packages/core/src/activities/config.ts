import { logger } from "../observability";
import { getRuntimeSettings } from "../settings";
import { DEFAULT_ACTIVITY_IDS } from "./defaults";
import { getActivitySyncVersion } from "./sync-version";

export const ACTIVITY_PROVIDER = "bokun";
export const ACTIVITY_CACHE_SYNC_TYPE = "activity_cache";

export interface ActivityCacheConfig {
	accountId: string;
	activityIds: string[];
	cronSecret?: string;
	currency: string;
	lang: string;
	staleAfterHours: number;
	syncIntervalHours: number;
	syncLeaseMinutes: number;
	syncVersion: number;
}

interface ActivityCacheEnvironment {
	ACTIVITY_SYNC_VERSION?: string;
	ACTIVITY_CURRENCY?: string;
	ACTIVITY_LANG?: string;
	BOKUN_ACCOUNT_ID?: string;
	BOKUN_ACTIVITY_IDS?: string;
	BOKUN_ACTIVITY_STALE_AFTER_HOURS?: string;
	BOKUN_ACTIVITY_SYNC_INTERVAL_HOURS?: string;
	BOKUN_ACTIVITY_SYNC_LEASE_MINUTES?: string;
	BOKUN_SYNC_CRON_SECRET?: string;
	CRON_SECRET?: string;
}

export function parseActivityIdList(raw: string): string[] {
	return [
		...new Set(
			raw
				.split(",")
				.map((value) => value.trim())
				.filter((value) => /^\d+$/.test(value)),
		),
	];
}

export function getActivityCacheConfig(
	environment: ActivityCacheEnvironment = {
		ACTIVITY_CURRENCY: process.env.ACTIVITY_CURRENCY,
		ACTIVITY_LANG: process.env.ACTIVITY_LANG,
		ACTIVITY_SYNC_VERSION: process.env.ACTIVITY_SYNC_VERSION,
		BOKUN_ACCOUNT_ID: process.env.BOKUN_ACCOUNT_ID,
		BOKUN_ACTIVITY_IDS: process.env.BOKUN_ACTIVITY_IDS,
		BOKUN_ACTIVITY_STALE_AFTER_HOURS:
			process.env.BOKUN_ACTIVITY_STALE_AFTER_HOURS,
		BOKUN_ACTIVITY_SYNC_INTERVAL_HOURS:
			process.env.BOKUN_ACTIVITY_SYNC_INTERVAL_HOURS,
		BOKUN_ACTIVITY_SYNC_LEASE_MINUTES:
			process.env.BOKUN_ACTIVITY_SYNC_LEASE_MINUTES,
		BOKUN_SYNC_CRON_SECRET: process.env.BOKUN_SYNC_CRON_SECRET,
		CRON_SECRET: process.env.CRON_SECRET,
	},
): ActivityCacheConfig {
	const configuredIds = environment.BOKUN_ACTIVITY_IDS?.trim();
	const parsedActivityIds = configuredIds
		? parseActivityIdList(configuredIds)
		: [];
	if (configuredIds && parsedActivityIds.length === 0) {
		logger.warn(
			"BOKUN_ACTIVITY_IDS was set but contained no valid numeric ids; falling back to defaults",
			{ configuredIds },
		);
	}
	const activityIds =
		parsedActivityIds.length > 0
			? parsedActivityIds
			: [...DEFAULT_ACTIVITY_IDS];

	return {
		accountId: environment.BOKUN_ACCOUNT_ID?.trim() || "default",
		activityIds,
		cronSecret: environment.BOKUN_SYNC_CRON_SECRET ?? environment.CRON_SECRET,
		currency: (environment.ACTIVITY_CURRENCY?.trim() || "EUR").toUpperCase(),
		lang: environment.ACTIVITY_LANG?.trim() || "en",
		staleAfterHours: optionalInteger(
			"BOKUN_ACTIVITY_STALE_AFTER_HOURS",
			environment.BOKUN_ACTIVITY_STALE_AFTER_HOURS,
			1,
			24 * 30,
			24,
		),
		syncIntervalHours: optionalInteger(
			"BOKUN_ACTIVITY_SYNC_INTERVAL_HOURS",
			environment.BOKUN_ACTIVITY_SYNC_INTERVAL_HOURS,
			1,
			24 * 30,
			24,
		),
		syncLeaseMinutes: optionalInteger(
			"BOKUN_ACTIVITY_SYNC_LEASE_MINUTES",
			environment.BOKUN_ACTIVITY_SYNC_LEASE_MINUTES,
			1,
			120,
			10,
		),
		syncVersion: getActivitySyncVersion({
			ACTIVITY_SYNC_VERSION: environment.ACTIVITY_SYNC_VERSION,
		}),
	};
}

export async function getActivityCacheConfigFromSettings(): Promise<ActivityCacheConfig> {
	const settings = await getRuntimeSettings();
	return getActivityCacheConfig({
		ACTIVITY_CURRENCY: String(settings["bokun.activityCurrency"]),
		ACTIVITY_LANG: String(settings["bokun.activityLang"]),
		ACTIVITY_SYNC_VERSION: String(settings["bokun.activitySyncVersion"]),
		BOKUN_ACCOUNT_ID: String(settings["bokun.accountId"]),
		BOKUN_ACTIVITY_IDS: String(settings["bokun.activityIds"]),
		BOKUN_ACTIVITY_STALE_AFTER_HOURS: String(
			settings["bokun.activityStaleAfterHours"],
		),
		BOKUN_ACTIVITY_SYNC_INTERVAL_HOURS: String(
			settings["bokun.activitySyncIntervalHours"],
		),
		BOKUN_ACTIVITY_SYNC_LEASE_MINUTES: String(
			settings["bokun.activitySyncLeaseMinutes"],
		),
		BOKUN_SYNC_CRON_SECRET: process.env.BOKUN_SYNC_CRON_SECRET,
		CRON_SECRET: process.env.CRON_SECRET,
	});
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
