import {
	type ActivityAvailabilityCalendar,
	type ActivityDetail,
	type ActivitySummary,
	toAvailabilityCalendar,
} from "@workspace/core/activities";
import {
	ACTIVITY_PROVIDER,
	ActivityCacheRepository,
	type ActivityCacheScope,
	getActivityCacheConfig,
} from "@workspace/core/activities/cache";
import {
	type BokunClient,
	createBokunClientFromEnv,
} from "@workspace/core/integrations/bokun";
import { logger } from "@workspace/core/observability";
import { getDb } from "@workspace/db";
import { cacheLife, cacheTag } from "next/cache";
import {
	ACTIVITIES_LIST_TAG,
	ACTIVITY_CURRENCY,
	ACTIVITY_LANG,
	activityDetailTag,
} from "./constants";

let client: BokunClient | null = null;

export function getActivityCatalogScope(): ActivityCacheScope {
	const config = getActivityCacheConfig();
	return { accountId: config.accountId, provider: ACTIVITY_PROVIDER };
}

function getActivityRepository(): ActivityCacheRepository {
	return new ActivityCacheRepository(getDb());
}

function getBokunClient(): BokunClient {
	client ??= createBokunClientFromEnv();
	return client;
}

/**
 * All curated activities as list-card summaries from the durable Bokun cache.
 * Cron revalidates this tag after syncs change, create or disable activities.
 */
export async function getCachedActivitySummaries(
	scope: ActivityCacheScope,
): Promise<ActivitySummary[]> {
	"use cache";
	cacheLife("max");
	cacheTag(ACTIVITIES_LIST_TAG);

	try {
		return await getActivityRepository().listSummaries(scope);
	} catch (error) {
		logger.warn("failed to load cached activity summaries", { error });
		return [];
	}
}

/** Full cached detail for one activity, or null when it is unknown/unavailable. */
export async function getCachedActivityDetail(
	id: string,
	scope: ActivityCacheScope,
): Promise<ActivityDetail | null> {
	"use cache";
	cacheLife("max");
	cacheTag(activityDetailTag(id));

	try {
		return await getActivityRepository().getDetail(scope, id);
	} catch (error) {
		logger.warn("failed to load cached activity detail", {
			activityId: id,
			error,
		});
		return null;
	}
}

export async function generateActivityStaticParams(): Promise<
	{ id: string }[]
> {
	try {
		const ids = await getActivityRepository().listActiveExternalIds(
			getActivityCatalogScope(),
		);
		if (ids.length === 0) {
			return [{ id: "__ci_placeholder__" }];
		}
		return ids.map((id) => ({ id }));
	} catch (error) {
		logger.warn("failed to generate activity static params", { error });
		return [{ id: "__ci_placeholder__" }];
	}
}

export function getActivityCurrency(): string {
	return getActivityCacheConfig().currency;
}

/**
 * Live departures/prices for an interval. Not cached: availability and price are
 * revalidated against Bokun on every request (see docs/data-architecture.md).
 */
export async function loadActivityAvailability(
	id: string,
	options: { start: string; end: string; currency?: string },
): Promise<ActivityAvailabilityCalendar> {
	const config = getActivityCacheConfig();
	const currency = options.currency ?? config.currency ?? ACTIVITY_CURRENCY;
	if (!config.activityIds.includes(id)) {
		return { currency, departuresByDate: {} };
	}

	try {
		const raw = await getBokunClient().v1.activity.getAvailabilities(id, {
			start: options.start,
			end: options.end,
			currency,
			lang: config.lang || ACTIVITY_LANG,
			// Keep sold-out departures so the day list can show a "sold out"
			// indicator rather than silently omitting the date.
			includeSoldOut: true,
		});
		return toAvailabilityCalendar(raw, { currency, includeSoldOut: true });
	} catch (error) {
		logger.warn("failed to load activity availability", {
			activityId: id,
			error,
		});
		return { currency, departuresByDate: {} };
	}
}
