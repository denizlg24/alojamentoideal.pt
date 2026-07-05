export interface ListingReviewSyncConfig {
	batchSize: number;
	cronSecret?: string;
	hostifyAccountId: string;
	leaseMinutes: number;
	maxPages: number;
	syncIntervalHours: number;
}

interface ListingReviewSyncEnvironment {
	CRON_SECRET?: string;
	HOSTIFY_ACCOUNT_ID?: string;
	HOSTIFY_REVIEW_SYNC_BATCH_SIZE?: string;
	HOSTIFY_REVIEW_SYNC_INTERVAL_HOURS?: string;
	HOSTIFY_REVIEW_SYNC_LEASE_MINUTES?: string;
	HOSTIFY_REVIEW_SYNC_MAX_PAGES?: string;
	HOSTIFY_SYNC_CRON_SECRET?: string;
}

export function getListingReviewSyncConfig(
	environment: ListingReviewSyncEnvironment = {
		CRON_SECRET: process.env.CRON_SECRET,
		HOSTIFY_ACCOUNT_ID: process.env.HOSTIFY_ACCOUNT_ID,
		HOSTIFY_REVIEW_SYNC_BATCH_SIZE: process.env.HOSTIFY_REVIEW_SYNC_BATCH_SIZE,
		HOSTIFY_REVIEW_SYNC_INTERVAL_HOURS:
			process.env.HOSTIFY_REVIEW_SYNC_INTERVAL_HOURS,
		HOSTIFY_REVIEW_SYNC_LEASE_MINUTES:
			process.env.HOSTIFY_REVIEW_SYNC_LEASE_MINUTES,
		HOSTIFY_REVIEW_SYNC_MAX_PAGES: process.env.HOSTIFY_REVIEW_SYNC_MAX_PAGES,
		HOSTIFY_SYNC_CRON_SECRET: process.env.HOSTIFY_SYNC_CRON_SECRET,
	},
): ListingReviewSyncConfig {
	return {
		batchSize: optionalInteger(
			"HOSTIFY_REVIEW_SYNC_BATCH_SIZE",
			environment.HOSTIFY_REVIEW_SYNC_BATCH_SIZE,
			1,
			100,
			10,
		),
		cronSecret: environment.HOSTIFY_SYNC_CRON_SECRET ?? environment.CRON_SECRET,
		hostifyAccountId: environment.HOSTIFY_ACCOUNT_ID ?? "default",
		leaseMinutes: optionalInteger(
			"HOSTIFY_REVIEW_SYNC_LEASE_MINUTES",
			environment.HOSTIFY_REVIEW_SYNC_LEASE_MINUTES,
			1,
			120,
			10,
		),
		maxPages: optionalInteger(
			"HOSTIFY_REVIEW_SYNC_MAX_PAGES",
			environment.HOSTIFY_REVIEW_SYNC_MAX_PAGES,
			1,
			500,
			50,
		),
		syncIntervalHours: optionalInteger(
			"HOSTIFY_REVIEW_SYNC_INTERVAL_HOURS",
			environment.HOSTIFY_REVIEW_SYNC_INTERVAL_HOURS,
			1,
			24 * 30,
			24,
		),
	};
}

export async function getListingReviewSyncConfigFromSettings(): Promise<ListingReviewSyncConfig> {
	const settings = await getRuntimeSettings();
	return getListingReviewSyncConfig({
		CRON_SECRET: process.env.CRON_SECRET,
		HOSTIFY_ACCOUNT_ID: String(settings["hostify.accountId"]),
		HOSTIFY_REVIEW_SYNC_BATCH_SIZE: String(
			settings["hostify.reviewSyncBatchSize"],
		),
		HOSTIFY_REVIEW_SYNC_INTERVAL_HOURS: String(
			settings["hostify.reviewSyncIntervalHours"],
		),
		HOSTIFY_REVIEW_SYNC_LEASE_MINUTES: String(
			settings["hostify.reviewSyncLeaseMinutes"],
		),
		HOSTIFY_REVIEW_SYNC_MAX_PAGES: String(
			settings["hostify.reviewSyncMaxPages"],
		),
		HOSTIFY_SYNC_CRON_SECRET: process.env.HOSTIFY_SYNC_CRON_SECRET,
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

import { getRuntimeSettings } from "../settings";
