import {
	type AccommodationListingNormalizedContent,
	type AccommodationListingProcessedContent,
	type AccommodationListingRawContent,
	accommodationListing,
	type Database,
	type ListingSectionHashes,
	providerSyncRun,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import type { ListingProcessingStatus } from "./processor";

export interface ListingState {
	processedSourceHash: string | null;
	processingStatus: string;
	sourceHash: string;
}

export interface UpsertListingInput {
	accountId: string;
	active: boolean;
	bathrooms: number | null;
	bedrooms: number | null;
	city: string | null;
	country: string | null;
	externalId: string;
	fetchedAt: Date;
	latitude: number | null;
	longitude: number | null;
	name: string | null;
	nickname: string | null;
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
	sectionHashes: ListingSectionHashes;
	sourceHash: string;
	staleAfter: Date;
	syncRunId: string;
	timezone: string | null;
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

export class ListingCacheRepository {
	readonly #db: Database;

	constructor(db: Database) {
		this.#db = db;
	}

	async createSyncRun(input: SyncRunInput): Promise<void> {
		await this.#db.insert(providerSyncRun).values(input);
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

	async findListingState(
		provider: string,
		accountId: string,
		externalId: string,
	): Promise<ListingState | null> {
		const [row] = await this.#db
			.select({
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

	async upsertListing(input: UpsertListingInput): Promise<void> {
		const now = new Date();
		const values: typeof accommodationListing.$inferInsert = {
			active: input.active,
			bathrooms: input.bathrooms,
			bedrooms: input.bedrooms,
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
					bathrooms: values.bathrooms,
					bedrooms: values.bedrooms,
					city: values.city,
					country: values.country,
					fetchedAt: values.fetchedAt,
					latitude: values.latitude,
					longitude: values.longitude,
					name: values.name,
					nickname: values.nickname,
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
