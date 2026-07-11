import {
	type AccommodationListingNormalizedContent,
	type AccommodationListingProcessedContent,
	type AccommodationListingRawContent,
	accommodationListing,
	type Database,
	type ListingSectionHashes,
	providerSyncRun,
	providerSyncState,
} from "@workspace/db";
import { and, asc, eq, sql } from "drizzle-orm";
import type { ListingProcessingStatus } from "./processor";

export interface ListingState {
	active: boolean;
	latitude: number | null;
	longitude: number | null;
	petFriendly?: boolean;
	processedSourceHash: string | null;
	processingStatus: string;
	sourceHash: string;
}

export interface UpsertListingInput {
	accountId: string;
	active: boolean;
	amenityKeys: string[];
	bathrooms: number | null;
	bedrooms: number | null;
	beds: number | null;
	city: string | null;
	country: string | null;
	externalId: string;
	fetchedAt: Date;
	latitude: number | null;
	longitude: number | null;
	name: string | null;
	nickname: string | null;
	petFriendly: boolean;
	normalized: AccommodationListingNormalizedContent;
	personCapacity: number | null;
	processed: AccommodationListingProcessedContent;
	processedAt: Date | null;
	processedSourceHash: string | null;
	processingError: string | null;
	processingStatus: ListingProcessingStatus;
	propertyType: string | null;
	provider: string;
	providerUpdatedAt: Date | null;
	raw: AccommodationListingRawContent;
	searchBody: string;
	searchLocation: string;
	searchTitle: string;
	sectionHashes: ListingSectionHashes;
	sourceHash: string;
	staleAfter: Date;
	syncRunId: string;
	timezone: string | null;
}

export interface RefreshListingCoordinatesInput {
	accountId: string;
	active: boolean;
	externalId: string;
	fetchedAt: Date;
	latitude: number | null;
	longitude: number | null;
	petFriendly: boolean;
	provider: string;
	sectionHashes: ListingSectionHashes;
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

export interface CompleteSyncRunInput {
	error?: string;
	finishedAt: Date;
	listingsCreated: number;
	listingsFailed: number;
	listingsSeen: number;
	listingsUnchanged: number;
	listingsUpdated: number;
	status: "completed" | "completed_with_errors" | "failed";
}

export interface ClaimedSyncState {
	activeRunId: string;
	nextPage: number;
	startedNewCycle: boolean;
}

export interface ClaimSyncStateInput {
	accountId: string;
	leaseExpiresAt: Date;
	newRunId: string;
	now: Date;
	provider: string;
	syncType: string;
	versionHash: number;
}

export interface AdvanceSyncStateInput {
	activeRunId: string;
	nextPage: number;
	now: Date;
	provider: string;
}

export interface CompleteSyncStateInput {
	activeRunId: string;
	error?: string;
	nextRunAt: Date;
	now: Date;
	provider: string;
	versionHash: number;
}

export interface FailSyncStateInput {
	activeRunId: string;
	error: string;
	nextRunAt: Date;
	now: Date;
	provider: string;
}

export interface IncrementSyncRunStatsInput {
	listingsCreated: number;
	listingsFailed: number;
	listingsSeen: number;
	listingsUnchanged: number;
	listingsUpdated: number;
}

export interface SyncRunStatsTotals {
	listingsFailed: number;
}

export interface FinishSyncRunInput {
	error?: string;
	finishedAt: Date;
	status: "completed" | "completed_with_errors" | "failed";
}

export interface SyncStateScopeInput {
	accountId: string;
	provider: string;
	syncType: string;
}

export interface SyncStateSnapshot {
	activeRunId: string | null;
	lastCompletedAt: Date | null;
	status: string;
}

export class ListingCacheRepository {
	readonly #db: Database;

	constructor(db: Database) {
		this.#db = db;
	}

	async createSyncRun(input: SyncRunInput): Promise<void> {
		await this.#db.insert(providerSyncRun).values(input).onConflictDoNothing();
	}

	async claimSyncState(
		input: ClaimSyncStateInput,
	): Promise<ClaimedSyncState | null> {
		const stateId = syncStateId(
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

		// A row starts a fresh cycle (new run id, page reset to 1) when it is not
		// mid-cycle, or when the code version it last ran under no longer matches
		// the current one. The version mismatch forces every listing to be
		// reprocessed under the new logic instead of resuming a stale cursor.
		const startNewCycle = sql`(
			${providerSyncState.status} in ('idle', 'complete', 'failed')
			or ${providerSyncState.versionHash} <> ${input.versionHash}
		)`;

		const [row] = await this.#db
			.update(providerSyncState)
			.set({
				activeRunId: sql<string>`case
					when ${startNewCycle}
						then ${input.newRunId}
					else ${providerSyncState.activeRunId}
				end`,
				error: null,
				lastStartedAt: sql<Date>`case
					when ${startNewCycle}
						then ${input.now}
					else ${providerSyncState.lastStartedAt}
				end`,
				leaseExpiresAt: input.leaseExpiresAt,
				nextPage: sql<number>`case
					when ${startNewCycle}
						then 1
					else ${providerSyncState.nextPage}
				end`,
				status: "running",
				updatedAt: input.now,
				// Stamp the version as soon as a fresh cycle is claimed. Otherwise a
				// multi-page sync would re-trigger startNewCycle on every poll
				// (resetting to page 1) because the version is only recorded at
				// completion, which a paging cycle never reaches.
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
			.returning({
				activeRunId: providerSyncState.activeRunId,
				nextPage: providerSyncState.nextPage,
				startedNewCycle: sql<boolean>`
					${providerSyncState.activeRunId} = ${input.newRunId}
				`,
			});

		if (!row?.activeRunId) {
			return null;
		}

		return {
			activeRunId: row.activeRunId,
			nextPage: row.nextPage,
			startedNewCycle: row.startedNewCycle,
		};
	}

	async completeSyncRun(
		id: string,
		input: CompleteSyncRunInput,
	): Promise<void> {
		await this.#db
			.update(providerSyncRun)
			.set(input)
			.where(eq(providerSyncRun.id, id));
	}

	async incrementSyncRunStats(
		id: string,
		input: IncrementSyncRunStatsInput,
	): Promise<SyncRunStatsTotals> {
		const [row] = await this.#db
			.update(providerSyncRun)
			.set({
				listingsCreated: sql`${providerSyncRun.listingsCreated} + ${input.listingsCreated}`,
				listingsFailed: sql`${providerSyncRun.listingsFailed} + ${input.listingsFailed}`,
				listingsSeen: sql`${providerSyncRun.listingsSeen} + ${input.listingsSeen}`,
				listingsUnchanged: sql`${providerSyncRun.listingsUnchanged} + ${input.listingsUnchanged}`,
				listingsUpdated: sql`${providerSyncRun.listingsUpdated} + ${input.listingsUpdated}`,
			})
			.where(eq(providerSyncRun.id, id))
			.returning({
				listingsFailed: providerSyncRun.listingsFailed,
			});

		return { listingsFailed: row?.listingsFailed ?? input.listingsFailed };
	}

	async finishSyncRun(id: string, input: FinishSyncRunInput): Promise<void> {
		await this.#db
			.update(providerSyncRun)
			.set(input)
			.where(eq(providerSyncRun.id, id));
	}

	async advanceSyncState(input: AdvanceSyncStateInput): Promise<void> {
		await this.#db
			.update(providerSyncState)
			.set({
				leaseExpiresAt: null,
				nextPage: input.nextPage,
				nextRunAt: input.now,
				status: "running",
				updatedAt: input.now,
			})
			.where(
				and(
					eq(providerSyncState.provider, input.provider),
					eq(providerSyncState.activeRunId, input.activeRunId),
				),
			);
	}

	async completeSyncState(input: CompleteSyncStateInput): Promise<void> {
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

	async failSyncState(input: FailSyncStateInput): Promise<void> {
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

	async getSyncState(
		input: SyncStateScopeInput,
	): Promise<SyncStateSnapshot | null> {
		const [row] = await this.#db
			.select({
				activeRunId: providerSyncState.activeRunId,
				lastCompletedAt: providerSyncState.lastCompletedAt,
				status: providerSyncState.status,
			})
			.from(providerSyncState)
			.where(
				and(
					eq(providerSyncState.provider, input.provider),
					eq(providerSyncState.externalAccountId, input.accountId),
					eq(providerSyncState.syncType, input.syncType),
				),
			)
			.limit(1);

		return row ?? null;
	}

	async isSyncStateComplete(input: SyncStateScopeInput): Promise<boolean> {
		const state = await this.getSyncState(input);
		return (
			state?.status === "skipped" ||
			(state?.status === "complete" && state.lastCompletedAt !== null)
		);
	}

	/**
	 * Returns a stable, ordered page of cached listing external ids for a scope.
	 * The review sync pages over these to fetch each listing's reviews; ordering
	 * by `externalId` keeps the cursor deterministic across runs.
	 */
	async listListingExternalIds(input: {
		accountId: string;
		limit: number;
		offset: number;
		provider: string;
	}): Promise<string[]> {
		const rows = await this.#db
			.select({ externalId: accommodationListing.externalId })
			.from(accommodationListing)
			.where(
				and(
					eq(accommodationListing.provider, input.provider),
					eq(accommodationListing.externalAccountId, input.accountId),
				),
			)
			.orderBy(asc(accommodationListing.externalId))
			.limit(input.limit)
			.offset(input.offset);

		return rows.map((row) => row.externalId);
	}

	async findListingState(
		provider: string,
		accountId: string,
		externalId: string,
	): Promise<ListingState | null> {
		const [row] = await this.#db
			.select({
				active: accommodationListing.active,
				latitude: accommodationListing.latitude,
				longitude: accommodationListing.longitude,
				petFriendly: accommodationListing.petFriendly,
				processedSourceHash: accommodationListing.processedSourceHash,
				processingStatus: accommodationListing.processingStatus,
				sourceHash: accommodationListing.sourceHash,
			})
			.from(accommodationListing)
			.where(
				and(
					eq(accommodationListing.provider, provider),
					eq(accommodationListing.externalAccountId, accountId),
					eq(accommodationListing.externalId, externalId),
				),
			)
			.limit(1);

		return row ?? null;
	}

	async refreshListingCoordinates(
		input: RefreshListingCoordinatesInput,
	): Promise<boolean> {
		const now = new Date();
		const [row] = await this.#db
			.update(accommodationListing)
			.set({
				active: input.active,
				fetchedAt: input.fetchedAt,
				latitude: input.latitude,
				longitude: input.longitude,
				petFriendly: input.petFriendly,
				sectionHashes: input.sectionHashes,
				staleAfter: input.staleAfter,
				syncRunId: input.syncRunId,
				updatedAt: now,
			})
			.where(
				and(
					eq(accommodationListing.provider, input.provider),
					eq(accommodationListing.externalAccountId, input.accountId),
					eq(accommodationListing.externalId, input.externalId),
					sql`(
						${accommodationListing.active} is distinct from ${input.active}
						or ${accommodationListing.latitude} is distinct from ${input.latitude}
						or ${accommodationListing.longitude} is distinct from ${input.longitude}
						or ${accommodationListing.petFriendly} is distinct from ${input.petFriendly}
					)`,
				),
			)
			.returning({ externalId: accommodationListing.externalId });

		return row !== undefined;
	}

	async upsertListing(input: UpsertListingInput): Promise<void> {
		const now = new Date();
		const values: typeof accommodationListing.$inferInsert = {
			active: input.active,
			amenityKeys: input.amenityKeys,
			bathrooms: input.bathrooms,
			bedrooms: input.bedrooms,
			beds: input.beds,
			city: input.city,
			country: input.country,
			externalAccountId: input.accountId,
			externalId: input.externalId,
			fetchedAt: input.fetchedAt,
			id: listingCacheId(input.provider, input.accountId, input.externalId),
			latitude: input.latitude,
			longitude: input.longitude,
			name: input.name,
			nickname: input.nickname,
			petFriendly: input.petFriendly,
			normalized: input.normalized,
			personCapacity: input.personCapacity,
			processed: input.processed,
			processedAt: input.processedAt,
			processedSourceHash: input.processedSourceHash,
			processingError: input.processingError,
			processingStatus: input.processingStatus,
			propertyType: input.propertyType,
			provider: input.provider,
			providerUpdatedAt: input.providerUpdatedAt,
			raw: input.raw,
			searchBody: input.searchBody,
			searchLocation: input.searchLocation,
			searchTitle: input.searchTitle,
			sectionHashes: input.sectionHashes,
			sourceHash: input.sourceHash,
			staleAfter: input.staleAfter,
			syncRunId: input.syncRunId,
			timezone: input.timezone,
			updatedAt: now,
		};

		await this.#db
			.insert(accommodationListing)
			.values(values)
			.onConflictDoUpdate({
				set: {
					active: values.active,
					amenityKeys: values.amenityKeys,
					bathrooms: values.bathrooms,
					bedrooms: values.bedrooms,
					beds: values.beds,
					city: values.city,
					country: values.country,
					fetchedAt: values.fetchedAt,
					latitude: values.latitude,
					longitude: values.longitude,
					name: values.name,
					nickname: values.nickname,
					petFriendly: values.petFriendly,
					normalized: values.normalized,
					personCapacity: values.personCapacity,
					processed: values.processed,
					processedAt: values.processedAt,
					processedSourceHash: values.processedSourceHash,
					processingError: values.processingError,
					processingStatus: values.processingStatus,
					propertyType: values.propertyType,
					providerUpdatedAt: values.providerUpdatedAt,
					raw: values.raw,
					searchBody: values.searchBody,
					searchLocation: values.searchLocation,
					searchTitle: values.searchTitle,
					sectionHashes: values.sectionHashes,
					sourceHash: values.sourceHash,
					staleAfter: values.staleAfter,
					syncRunId: values.syncRunId,
					timezone: values.timezone,
					updatedAt: values.updatedAt,
				},
				target: [
					accommodationListing.provider,
					accommodationListing.externalAccountId,
					accommodationListing.externalId,
				],
			});
	}
}

export function listingCacheId(
	provider: string,
	accountId: string,
	externalId: string,
): string {
	return `${provider}:${accountId}:${externalId}`;
}

export function syncStateId(
	provider: string,
	accountId: string,
	syncType: string,
): string {
	return `${provider}:${accountId}:${syncType}`;
}
