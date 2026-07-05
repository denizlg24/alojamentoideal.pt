import {
	activityExperience,
	type Database,
	providerSyncRun,
	providerSyncState,
} from "@workspace/db";
import { and, asc, eq, notInArray, sql } from "drizzle-orm";
import type { ActivityDetail, ActivitySummary } from "./types";

export interface ActivityCacheScope {
	accountId: string;
	provider: string;
}

export interface ActivityState {
	active: boolean;
	sortOrder: number;
	sourceHash: string;
}

export interface UpsertActivityInput extends ActivityCacheScope {
	active: boolean;
	city: string | null;
	country: string | null;
	detail: ActivityDetail;
	difficulty: string | null;
	durationBucket: string | null;
	externalId: string;
	fetchedAt: Date;
	fromPriceAmount: number | null;
	fromPriceCurrency: string | null;
	raw: unknown;
	sortOrder: number;
	sourceHash: string;
	staleAfter: Date;
	summary: ActivitySummary;
	syncRunId: string;
	title: string;
}

export interface DisableMissingActivitiesInput extends ActivityCacheScope {
	fetchedAt: Date;
	keepExternalIds: string[];
	staleAfter: Date;
	syncRunId: string;
}

export interface SyncRunInput {
	id: string;
	provider: string;
	status: "running";
	syncType: string;
	trigger: string;
}

export interface FinishActivitySyncRunInput {
	activitiesCreated: number;
	activitiesDisabled: number;
	activitiesFailed: number;
	activitiesSeen: number;
	activitiesUnchanged: number;
	activitiesUpdated: number;
	error?: string;
	finishedAt: Date;
	status: "completed" | "completed_with_errors" | "failed";
}

export interface ClaimedActivitySyncState {
	activeRunId: string;
}

export interface ClaimActivitySyncStateInput {
	accountId: string;
	leaseExpiresAt: Date;
	newRunId: string;
	now: Date;
	provider: string;
	syncType: string;
	versionHash: number;
}

export interface CompleteActivitySyncStateInput {
	activeRunId: string;
	error?: string;
	nextRunAt: Date;
	now: Date;
	provider: string;
	versionHash: number;
}

export interface FailActivitySyncStateInput {
	activeRunId: string;
	error: string;
	nextRunAt: Date;
	now: Date;
	provider: string;
}

export class ActivityCacheRepository {
	readonly #db: Database;

	constructor(db: Database) {
		this.#db = db;
	}

	async listSummaries(scope: ActivityCacheScope): Promise<ActivitySummary[]> {
		const rows = await this.#db
			.select({ summary: activityExperience.summary })
			.from(activityExperience)
			.where(
				and(
					eq(activityExperience.provider, scope.provider),
					eq(activityExperience.externalAccountId, scope.accountId),
					eq(activityExperience.active, true),
				),
			)
			.orderBy(
				asc(activityExperience.sortOrder),
				asc(activityExperience.externalId),
			);

		return rows.map((row) => row.summary as ActivitySummary);
	}

	async getDetail(
		scope: ActivityCacheScope,
		externalId: string,
	): Promise<ActivityDetail | null> {
		const [row] = await this.#db
			.select({ detail: activityExperience.detail })
			.from(activityExperience)
			.where(
				and(
					eq(activityExperience.provider, scope.provider),
					eq(activityExperience.externalAccountId, scope.accountId),
					eq(activityExperience.externalId, externalId),
					eq(activityExperience.active, true),
				),
			)
			.limit(1);

		return row ? (row.detail as ActivityDetail) : null;
	}

	async listActiveExternalIds(scope: ActivityCacheScope): Promise<string[]> {
		const rows = await this.#db
			.select({ externalId: activityExperience.externalId })
			.from(activityExperience)
			.where(
				and(
					eq(activityExperience.provider, scope.provider),
					eq(activityExperience.externalAccountId, scope.accountId),
					eq(activityExperience.active, true),
				),
			)
			.orderBy(
				asc(activityExperience.sortOrder),
				asc(activityExperience.externalId),
			);

		return rows.map((row) => row.externalId);
	}

	async findActivityState(
		scope: ActivityCacheScope,
		externalId: string,
	): Promise<ActivityState | null> {
		const [row] = await this.#db
			.select({
				active: activityExperience.active,
				sortOrder: activityExperience.sortOrder,
				sourceHash: activityExperience.sourceHash,
			})
			.from(activityExperience)
			.where(
				and(
					eq(activityExperience.provider, scope.provider),
					eq(activityExperience.externalAccountId, scope.accountId),
					eq(activityExperience.externalId, externalId),
				),
			)
			.limit(1);

		return row ?? null;
	}

	async upsertActivity(input: UpsertActivityInput): Promise<void> {
		const now = new Date();
		const values: typeof activityExperience.$inferInsert = {
			active: input.active,
			city: input.city,
			country: input.country,
			detail: input.detail,
			difficulty: input.difficulty,
			durationBucket: input.durationBucket,
			externalAccountId: input.accountId,
			externalId: input.externalId,
			fetchedAt: input.fetchedAt,
			fromPriceAmount: input.fromPriceAmount,
			fromPriceCurrency: input.fromPriceCurrency,
			id: activityCacheId(input.provider, input.accountId, input.externalId),
			provider: input.provider,
			raw: input.raw,
			sortOrder: input.sortOrder,
			sourceHash: input.sourceHash,
			staleAfter: input.staleAfter,
			summary: input.summary,
			syncRunId: input.syncRunId,
			title: input.title,
			updatedAt: now,
		};

		await this.#db
			.insert(activityExperience)
			.values(values)
			.onConflictDoUpdate({
				set: {
					active: values.active,
					city: values.city,
					country: values.country,
					detail: values.detail,
					difficulty: values.difficulty,
					durationBucket: values.durationBucket,
					fetchedAt: values.fetchedAt,
					fromPriceAmount: values.fromPriceAmount,
					fromPriceCurrency: values.fromPriceCurrency,
					raw: values.raw,
					sortOrder: values.sortOrder,
					sourceHash: values.sourceHash,
					staleAfter: values.staleAfter,
					summary: values.summary,
					syncRunId: values.syncRunId,
					title: values.title,
					updatedAt: values.updatedAt,
				},
				target: [
					activityExperience.provider,
					activityExperience.externalAccountId,
					activityExperience.externalId,
				],
			});
	}

	async disableMissingActivities(
		input: DisableMissingActivitiesInput,
	): Promise<string[]> {
		const predicates = [
			eq(activityExperience.provider, input.provider),
			eq(activityExperience.externalAccountId, input.accountId),
			eq(activityExperience.active, true),
		];
		if (input.keepExternalIds.length > 0) {
			predicates.push(
				notInArray(activityExperience.externalId, input.keepExternalIds),
			);
		}

		const rows = await this.#db
			.update(activityExperience)
			.set({
				active: false,
				fetchedAt: input.fetchedAt,
				staleAfter: input.staleAfter,
				syncRunId: input.syncRunId,
				updatedAt: new Date(),
			})
			.where(and(...predicates))
			.returning({ externalId: activityExperience.externalId });

		return rows.map((row) => row.externalId);
	}

	async createSyncRun(input: SyncRunInput): Promise<void> {
		await this.#db.insert(providerSyncRun).values(input).onConflictDoNothing();
	}

	async finishActivitySyncRun(
		id: string,
		input: FinishActivitySyncRunInput,
	): Promise<void> {
		await this.#db
			.update(providerSyncRun)
			.set(input)
			.where(eq(providerSyncRun.id, id));
	}

	async claimSyncState(
		input: ClaimActivitySyncStateInput,
	): Promise<ClaimedActivitySyncState | null> {
		const stateId = activitySyncStateId(
			input.provider,
			input.accountId,
			input.syncType,
		);

		await this.#db
			.insert(providerSyncState)
			.values({
				externalAccountId: input.accountId,
				id: stateId,
				nextRunAt: input.now,
				provider: input.provider,
				syncType: input.syncType,
			})
			.onConflictDoNothing();

		const [row] = await this.#db
			.update(providerSyncState)
			.set({
				activeRunId: input.newRunId,
				error: null,
				lastStartedAt: input.now,
				leaseExpiresAt: input.leaseExpiresAt,
				nextPage: 1,
				status: "running",
				updatedAt: input.now,
				versionHash: input.versionHash,
			})
			.where(sql`
				${providerSyncState.id} = ${stateId}
				and (
					${providerSyncState.leaseExpiresAt} is null
					or ${providerSyncState.leaseExpiresAt} <= ${input.now}
				)
				and (
					${providerSyncState.nextRunAt} <= ${input.now}
					or ${providerSyncState.versionHash} <> ${input.versionHash}
				)
			`)
			.returning({ activeRunId: providerSyncState.activeRunId });

		if (!row?.activeRunId) {
			return null;
		}

		return { activeRunId: row.activeRunId };
	}

	async completeSyncState(
		input: CompleteActivitySyncStateInput,
	): Promise<void> {
		await this.#db
			.update(providerSyncState)
			.set({
				activeRunId: null,
				error: input.error,
				lastCompletedAt: input.now,
				leaseExpiresAt: null,
				nextPage: 1,
				nextRunAt: input.nextRunAt,
				status: input.error ? "failed" : "complete",
				updatedAt: input.now,
				versionHash: input.versionHash,
			})
			.where(
				and(
					eq(providerSyncState.provider, input.provider),
					eq(providerSyncState.activeRunId, input.activeRunId),
				),
			);
	}

	async failSyncState(input: FailActivitySyncStateInput): Promise<void> {
		await this.#db
			.update(providerSyncState)
			.set({
				error: input.error,
				leaseExpiresAt: null,
				nextRunAt: input.nextRunAt,
				status: "failed",
				updatedAt: input.now,
			})
			.where(
				and(
					eq(providerSyncState.provider, input.provider),
					eq(providerSyncState.activeRunId, input.activeRunId),
				),
			);
	}
}

export function activityCacheId(
	provider: string,
	accountId: string,
	externalId: string,
): string {
	return `${provider}:${accountId}:${externalId}`;
}

export function activitySyncStateId(
	provider: string,
	accountId: string,
	syncType: string,
): string {
	return `${provider}:${accountId}:${syncType}`;
}
