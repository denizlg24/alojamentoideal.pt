import { getDb } from "@workspace/db";
import type { BokunClient } from "../integrations/bokun";
import { createBokunClientFromEnv } from "../integrations/bokun";
import { sanitizeProviderPayload, stableHash } from "../listing-cache/hash";
import {
	ActivityCacheRepository,
	type ActivityCacheScope,
	type ActivityState,
} from "./cache-repository";
import {
	ACTIVITY_CACHE_SYNC_TYPE,
	ACTIVITY_PROVIDER,
	type ActivityCacheConfig,
	getActivityCacheConfigFromSettings,
} from "./config";
import { toActivityDetail, toActivitySummary } from "./mappers";
import { ACTIVITY_SYNC_VERSION } from "./sync-version";
import type { ActivityDetail, ActivitySummary } from "./types";

const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;
const MILLISECONDS_PER_MINUTE = 60 * 1000;

type BokunActivityClient = Pick<BokunClient, "v1">;

export interface BokunActivitySyncStats {
	activitiesCreated: number;
	activitiesDisabled: number;
	activitiesFailed: number;
	activitiesSeen: number;
	activitiesUnchanged: number;
	activitiesUpdated: number;
	changedExternalIds: string[];
	errors: SyncActivityError[];
	runId: string;
	status: "completed" | "completed_with_errors" | "failed";
}

export interface BokunActivityPollResult {
	data: BokunActivitySyncStats | null;
	nextRunAt: string | null;
	status: "completed" | "failed" | "skipped";
}

export interface SyncActivityError {
	error: string;
	externalId: string;
}

interface BokunActivityCacheSyncOptions {
	client: BokunActivityClient;
	config: ActivityCacheConfig;
	now?: () => Date;
	repository: ActivityCacheRepository;
}

interface ActivityProjection {
	detail: ActivityDetail;
	raw: unknown;
	sourceHash: string;
	summary: ActivitySummary;
}

export async function createBokunActivityCacheSyncFromEnv(
	config?: ActivityCacheConfig,
) {
	const resolvedConfig = config ?? (await getActivityCacheConfigFromSettings());

	return new BokunActivityCacheSync({
		client: createBokunClientFromEnv(),
		config: resolvedConfig,
		repository: new ActivityCacheRepository(getDb()),
	});
}

export class BokunActivityCacheSync {
	readonly #client: BokunActivityClient;
	readonly #config: ActivityCacheConfig;
	readonly #now: () => Date;
	readonly #repository: ActivityCacheRepository;

	constructor(options: BokunActivityCacheSyncOptions) {
		this.#client = options.client;
		this.#config = options.config;
		this.#now = options.now ?? (() => new Date());
		this.#repository = options.repository;
	}

	async syncActivities(trigger = "cron"): Promise<BokunActivitySyncStats> {
		const runId = crypto.randomUUID();
		const stats = emptyStats(runId);

		await this.#repository.createSyncRun({
			id: runId,
			provider: ACTIVITY_PROVIDER,
			status: "running",
			syncType: ACTIVITY_CACHE_SYNC_TYPE,
			trigger,
		});

		try {
			await this.syncConfiguredActivities(runId, stats);
			stats.status =
				stats.activitiesFailed > 0 ? "completed_with_errors" : "completed";
			await this.finishRun(runId, stats);
			return stats;
		} catch (error) {
			stats.status = "failed";
			await this.finishRun(runId, stats, normalizeError(error));
			throw error;
		}
	}

	async pollActivities(trigger = "poll"): Promise<BokunActivityPollResult> {
		const now = this.#now();
		const runId = crypto.randomUUID();
		const claim = await this.#repository.claimSyncState({
			accountId: this.#config.accountId,
			leaseExpiresAt: new Date(
				now.getTime() + this.#config.syncLeaseMinutes * MILLISECONDS_PER_MINUTE,
			),
			newRunId: runId,
			now,
			provider: ACTIVITY_PROVIDER,
			syncType: ACTIVITY_CACHE_SYNC_TYPE,
			versionHash: ACTIVITY_SYNC_VERSION,
		});

		if (!claim) {
			return { data: null, nextRunAt: null, status: "skipped" };
		}

		const activeRunId = claim.activeRunId;
		const stats = emptyStats(activeRunId);

		await this.#repository.createSyncRun({
			id: activeRunId,
			provider: ACTIVITY_PROVIDER,
			status: "running",
			syncType: ACTIVITY_CACHE_SYNC_TYPE,
			trigger,
		});

		try {
			await this.syncConfiguredActivities(activeRunId, stats);
			stats.status =
				stats.activitiesFailed > 0 ? "completed_with_errors" : "completed";
			const finishedAt = this.#now();
			await this.finishRun(activeRunId, stats, undefined, finishedAt);
			// A run where every fetched activity failed is a provider outage, not a
			// steady state: `syncActivity` swallows per-activity errors so it never
			// throws into the catch below. Fall back to the short lease backoff so we
			// retry within minutes instead of waiting a full sync interval.
			const isTotalFailure =
				stats.activitiesSeen > 0 &&
				stats.activitiesFailed === stats.activitiesSeen;
			const nextRunDelayMs = isTotalFailure
				? this.#config.syncLeaseMinutes * MILLISECONDS_PER_MINUTE
				: this.#config.syncIntervalHours * MILLISECONDS_PER_HOUR;
			const nextRunAt = new Date(finishedAt.getTime() + nextRunDelayMs);
			await this.#repository.completeSyncState({
				activeRunId,
				error:
					stats.status === "completed_with_errors"
						? `${stats.activitiesFailed} activity experience(s) failed`
						: undefined,
				nextRunAt,
				now: finishedAt,
				provider: ACTIVITY_PROVIDER,
				versionHash: ACTIVITY_SYNC_VERSION,
			});

			return {
				data: stats,
				nextRunAt: nextRunAt.toISOString(),
				status: "completed",
			};
		} catch (error) {
			stats.status = "failed";
			const failedAt = this.#now();
			const message = normalizeError(error);
			await this.finishRun(activeRunId, stats, message, failedAt);
			await this.#repository.failSyncState({
				activeRunId,
				error: message,
				nextRunAt: new Date(
					failedAt.getTime() +
						this.#config.syncLeaseMinutes * MILLISECONDS_PER_MINUTE,
				),
				now: failedAt,
				provider: ACTIVITY_PROVIDER,
			});

			throw error;
		}
	}

	private async syncConfiguredActivities(
		runId: string,
		stats: BokunActivitySyncStats,
	): Promise<void> {
		const scope: ActivityCacheScope = {
			accountId: this.#config.accountId,
			provider: ACTIVITY_PROVIDER,
		};

		for (const [sortOrder, externalId] of this.#config.activityIds.entries()) {
			stats.activitiesSeen += 1;
			await this.syncActivity(runId, stats, scope, externalId, sortOrder);
		}

		const fetchedAt = this.#now();
		const disabled = await this.#repository.disableMissingActivities({
			...scope,
			fetchedAt,
			keepExternalIds: this.#config.activityIds,
			staleAfter: staleAfter(fetchedAt, this.#config.staleAfterHours),
			syncRunId: runId,
		});
		stats.activitiesDisabled = disabled.length;
		for (const externalId of disabled) {
			pushUnique(stats.changedExternalIds, externalId);
		}
	}

	private async syncActivity(
		runId: string,
		stats: BokunActivitySyncStats,
		scope: ActivityCacheScope,
		externalId: string,
		sortOrder: number,
	): Promise<void> {
		try {
			const projection = await this.fetchProjection(externalId);
			const existing = await this.#repository.findActivityState(
				scope,
				externalId,
			);

			if (isUnchanged(existing, projection.sourceHash, sortOrder)) {
				stats.activitiesUnchanged += 1;
				return;
			}

			const fetchedAt = this.#now();
			await this.#repository.upsertActivity({
				...scope,
				active: true,
				city: projection.summary.location?.city ?? null,
				country: projection.summary.location?.country ?? null,
				detail: projection.detail,
				difficulty: projection.summary.difficulty,
				durationBucket: projection.summary.duration.bucket,
				externalId,
				fetchedAt,
				fromPriceAmount: projection.summary.fromPrice?.amount ?? null,
				fromPriceCurrency: projection.summary.fromPrice?.currency ?? null,
				raw: projection.raw,
				sortOrder,
				sourceHash: projection.sourceHash,
				staleAfter: staleAfter(fetchedAt, this.#config.staleAfterHours),
				summary: projection.summary,
				syncRunId: runId,
				title: projection.summary.title,
			});

			pushUnique(stats.changedExternalIds, externalId);
			if (existing) {
				stats.activitiesUpdated += 1;
			} else {
				stats.activitiesCreated += 1;
			}
		} catch (error) {
			stats.activitiesFailed += 1;
			stats.errors.push({
				error: normalizeError(error),
				externalId,
			});
		}
	}

	private async fetchProjection(
		externalId: string,
	): Promise<ActivityProjection> {
		const raw = await this.#client.v1.activity.get(externalId, {
			currency: this.#config.currency,
			lang: this.#config.lang,
		});
		const summary = toActivitySummary(raw, { currency: this.#config.currency });
		const detail = toActivityDetail(raw, { currency: this.#config.currency });
		if (!summary || !detail) {
			throw new Error("Bokun activity response did not include an id");
		}

		const sanitizedRaw = sanitizeProviderPayload(raw);
		return {
			detail,
			raw: sanitizedRaw,
			sourceHash: stableHash(sanitizedRaw),
			summary,
		};
	}

	private async finishRun(
		runId: string,
		stats: BokunActivitySyncStats,
		error?: string,
		finishedAt = this.#now(),
	): Promise<void> {
		await this.#repository.finishActivitySyncRun(runId, {
			activitiesCreated: stats.activitiesCreated,
			activitiesDisabled: stats.activitiesDisabled,
			activitiesFailed: stats.activitiesFailed,
			activitiesSeen: stats.activitiesSeen,
			activitiesUnchanged: stats.activitiesUnchanged,
			activitiesUpdated: stats.activitiesUpdated,
			error,
			finishedAt,
			status: stats.status,
		});
	}
}

function emptyStats(runId: string): BokunActivitySyncStats {
	return {
		activitiesCreated: 0,
		activitiesDisabled: 0,
		activitiesFailed: 0,
		activitiesSeen: 0,
		activitiesUnchanged: 0,
		activitiesUpdated: 0,
		changedExternalIds: [],
		errors: [],
		runId,
		status: "completed",
	};
}

function isUnchanged(
	existing: ActivityState | null,
	sourceHash: string,
	sortOrder: number,
): boolean {
	return (
		existing?.active === true &&
		existing.sourceHash === sourceHash &&
		existing.sortOrder === sortOrder
	);
}

function staleAfter(fetchedAt: Date, hours: number): Date {
	return new Date(fetchedAt.getTime() + hours * MILLISECONDS_PER_HOUR);
}

function pushUnique(values: string[], value: string): void {
	if (!values.includes(value)) {
		values.push(value);
	}
}

function normalizeError(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}

	return "Bokun activity sync failed";
}
