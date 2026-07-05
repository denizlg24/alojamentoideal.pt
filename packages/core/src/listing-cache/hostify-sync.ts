import { getDb } from "@workspace/db";
import { buildListingSearchIndex } from "../catalog/search-index";
import type { HostifyClient } from "../integrations/hostify/index";
import {
	createHostifyClientFromEnv,
	HostifyApiError,
} from "../integrations/hostify/index";
import type { ListingCacheConfig } from "./config";
import { getListingCacheConfigFromSettings } from "./config";
import {
	buildListingCacheProjection,
	type HostifyListingSections,
	type ListingCacheProjection,
} from "./normalizer";
import {
	createListingContentProcessor,
	type ListingContentProcessor,
	listingProcessingInput,
} from "./processor";
import { ListingCacheRepository, type ListingState } from "./repository";

export const HOSTIFY_PROVIDER = "hostify";
export const LISTING_CACHE_SYNC_TYPE = "listing_cache";
const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;
const MILLISECONDS_PER_MINUTE = 60 * 1000;

export interface HostifyListingSyncStats {
	/**
	 * External IDs of listings created or updated during the run. Consumers use
	 * this to invalidate exactly the catalog cache entries that changed.
	 */
	changedExternalIds: string[];
	errors: SyncListingError[];
	listingsCreated: number;
	listingsFailed: number;
	listingsSeen: number;
	listingsUnchanged: number;
	listingsUpdated: number;
	runId: string;
	status: "completed" | "completed_with_errors" | "failed";
}

export interface HostifyListingPollResult {
	data: HostifyListingSyncStats | null;
	nextPage: number | null;
	nextRunAt: string | null;
	page: number | null;
	status: "advanced" | "completed" | "failed" | "skipped";
}

export interface SyncListingError {
	error: string;
	externalId: string | null;
}

interface HostifyListingCacheSyncOptions {
	client: Pick<HostifyClient, "listings">;
	config: ListingCacheConfig;
	now?: () => Date;
	processor: ListingContentProcessor;
	repository: ListingCacheRepository;
}

export async function createHostifyListingCacheSyncFromEnv() {
	const config = await getListingCacheConfigFromSettings();

	return new HostifyListingCacheSync({
		client: createHostifyClientFromEnv(),
		config,
		processor: createListingContentProcessor({
			apiKey: config.openaiApiKey,
			enabled: config.llmEnabled,
			model: config.openaiModel,
		}),
		repository: new ListingCacheRepository(getDb()),
	});
}

export class HostifyListingCacheSync {
	readonly #client: Pick<HostifyClient, "listings">;
	readonly #config: ListingCacheConfig;
	readonly #now: () => Date;
	readonly #processor: ListingContentProcessor;
	readonly #repository: ListingCacheRepository;

	constructor(options: HostifyListingCacheSyncOptions) {
		this.#client = options.client;
		this.#config = options.config;
		this.#now = options.now ?? (() => new Date());
		this.#processor = options.processor;
		this.#repository = options.repository;
	}

	async syncListings(trigger = "cron"): Promise<HostifyListingSyncStats> {
		const runId = crypto.randomUUID();
		const stats: HostifyListingSyncStats = {
			changedExternalIds: [],
			errors: [],
			listingsCreated: 0,
			listingsFailed: 0,
			listingsSeen: 0,
			listingsUnchanged: 0,
			listingsUpdated: 0,
			runId,
			status: "completed",
		};

		await this.#repository.createSyncRun({
			id: runId,
			provider: HOSTIFY_PROVIDER,
			status: "running",
			syncType: LISTING_CACHE_SYNC_TYPE,
			trigger,
		});

		try {
			await this.syncPages(runId, stats);
			stats.status =
				stats.listingsFailed > 0 ? "completed_with_errors" : "completed";
			await this.completeRun(runId, stats);
			return stats;
		} catch (error) {
			stats.status = "failed";
			await this.completeRun(runId, stats, normalizeError(error));
			throw error;
		}
	}

	async pollListings(trigger = "poll"): Promise<HostifyListingPollResult> {
		const now = this.#now();
		const newRunId = crypto.randomUUID();
		const claim = await this.#repository.claimSyncState({
			accountId: this.#config.hostifyAccountId,
			leaseExpiresAt: new Date(
				now.getTime() +
					this.#config.incrementalLeaseMinutes * MILLISECONDS_PER_MINUTE,
			),
			newRunId,
			now,
			provider: HOSTIFY_PROVIDER,
			syncType: LISTING_CACHE_SYNC_TYPE,
			versionHash: this.#config.syncVersion,
		});

		if (!claim) {
			return {
				data: null,
				nextPage: null,
				nextRunAt: null,
				page: null,
				status: "skipped",
			};
		}

		const runId = claim.activeRunId;
		await this.#repository.createSyncRun({
			id: runId,
			provider: HOSTIFY_PROVIDER,
			status: "running",
			syncType: LISTING_CACHE_SYNC_TYPE,
			trigger,
		});

		const stats = emptyStats(runId);

		try {
			const response = await this.#client.listings.list({
				include_related_objects: 1,
				page: claim.nextPage,
				per_page: this.#config.incrementalBatchSize,
			});

			for (const listing of response.listings) {
				stats.listingsSeen += 1;
				await this.syncListing(runId, stats, listing);
			}

			const totals = await this.#repository.incrementSyncRunStats(runId, stats);

			const finished =
				response.listings.length === 0 ||
				response.listings.length < this.#config.incrementalBatchSize ||
				claim.nextPage >= this.#config.syncMaxPages;
			const finishedAt = this.#now();

			if (finished) {
				stats.status =
					totals.listingsFailed > 0 ? "completed_with_errors" : "completed";
				await this.#repository.finishSyncRun(runId, {
					finishedAt,
					status: stats.status,
				});
				const nextRunAt = new Date(
					finishedAt.getTime() +
						this.#config.incrementalSyncIntervalHours * MILLISECONDS_PER_HOUR,
				);
				await this.#repository.completeSyncState({
					activeRunId: runId,
					error:
						stats.status === "completed_with_errors"
							? `${stats.listingsFailed} listing(s) failed`
							: undefined,
					nextRunAt,
					now: finishedAt,
					provider: HOSTIFY_PROVIDER,
					versionHash: this.#config.syncVersion,
				});

				return {
					data: stats,
					nextPage: null,
					nextRunAt: nextRunAt.toISOString(),
					page: claim.nextPage,
					status: "completed",
				};
			}

			const nextPage = claim.nextPage + 1;
			await this.#repository.advanceSyncState({
				activeRunId: runId,
				nextPage,
				now: finishedAt,
				provider: HOSTIFY_PROVIDER,
			});

			stats.status =
				stats.listingsFailed > 0 ? "completed_with_errors" : "completed";

			return {
				data: stats,
				nextPage,
				nextRunAt: finishedAt.toISOString(),
				page: claim.nextPage,
				status: "advanced",
			};
		} catch (error) {
			stats.status = "failed";
			const failedAt = this.#now();
			const message = normalizeError(error);
			await this.#repository.finishSyncRun(runId, {
				error: message,
				finishedAt: failedAt,
				status: stats.status,
			});
			await this.#repository.failSyncState({
				activeRunId: runId,
				error: message,
				nextRunAt: new Date(
					failedAt.getTime() +
						this.#config.incrementalLeaseMinutes * MILLISECONDS_PER_MINUTE,
				),
				now: failedAt,
				provider: HOSTIFY_PROVIDER,
			});

			throw error;
		}
	}

	private async syncPages(
		runId: string,
		stats: HostifyListingSyncStats,
	): Promise<void> {
		for (let page = 1; page <= this.#config.syncMaxPages; page += 1) {
			const response = await this.#client.listings.list({
				include_related_objects: 1,
				page,
				per_page: this.#config.syncPerPage,
			});

			if (response.listings.length === 0) {
				return;
			}

			for (const listing of response.listings) {
				stats.listingsSeen += 1;
				await this.syncListing(runId, stats, listing);
			}

			if (response.listings.length < this.#config.syncPerPage) {
				return;
			}
		}
	}

	private async syncListing(
		runId: string,
		stats: HostifyListingSyncStats,
		listingSummary: unknown,
	): Promise<void> {
		let externalId: string | null = null;

		try {
			externalId = readListingId(listingSummary);
			const sections = await this.fetchSections(externalId, listingSummary);
			const projection = buildListingCacheProjection(sections, {
				syncVersion: this.#config.syncVersion,
			});
			const existing = await this.#repository.findListingState(
				HOSTIFY_PROVIDER,
				this.#config.hostifyAccountId,
				projection.externalId,
			);
			const sourceChanged = existing?.sourceHash !== projection.sourceHash;
			const processingNeeded =
				this.#processor.enabled &&
				(existing?.processedSourceHash !== projection.sourceHash ||
					existing?.processingStatus !== "processed");
			const derivedRefreshNeeded =
				existing !== null && derivedFieldsChanged(existing, projection);

			if (!sourceChanged && !processingNeeded && !derivedRefreshNeeded) {
				stats.listingsUnchanged += 1;
				return;
			}

			if (!sourceChanged && !processingNeeded && derivedRefreshNeeded) {
				const fetchedAt = this.#now();
				const updated = await this.#repository.refreshListingCoordinates({
					accountId: this.#config.hostifyAccountId,
					active: projection.active,
					externalId: projection.externalId,
					fetchedAt,
					latitude: projection.latitude,
					longitude: projection.longitude,
					provider: HOSTIFY_PROVIDER,
					sectionHashes: projection.sectionHashes,
					staleAfter: new Date(
						fetchedAt.getTime() +
							this.#config.staleAfterHours * MILLISECONDS_PER_HOUR,
					),
					syncRunId: runId,
				});

				if (updated) {
					stats.changedExternalIds.push(projection.externalId);
					stats.listingsUpdated += 1;
				} else {
					stats.listingsUnchanged += 1;
				}
				return;
			}

			const processing = await this.#processor.process(
				listingProcessingInput(projection),
			);
			const fetchedAt = this.#now();
			const searchIndex = buildListingSearchIndex({
				city: projection.city,
				country: projection.country,
				name: projection.name,
				nickname: projection.nickname,
				processed: processing.content,
				propertyType: projection.propertyType,
			});

			await this.#repository.upsertListing({
				accountId: this.#config.hostifyAccountId,
				active: projection.active,
				amenityKeys: searchIndex.amenityKeys,
				bathrooms: projection.bathrooms,
				bedrooms: projection.bedrooms,
				beds: projection.beds,
				city: projection.city,
				country: projection.country,
				externalId: projection.externalId,
				fetchedAt,
				latitude: projection.latitude,
				longitude: projection.longitude,
				name: projection.name,
				nickname: projection.nickname,
				normalized: projection.normalized,
				personCapacity: projection.personCapacity,
				processed: processing.content,
				processedAt: processing.processedAt,
				processedSourceHash: processing.processedSourceHash,
				processingError: processing.error,
				processingStatus: processing.status,
				propertyType: projection.propertyType,
				provider: HOSTIFY_PROVIDER,
				providerUpdatedAt: projection.providerUpdatedAt,
				raw: projection.raw,
				searchBody: searchIndex.searchBody,
				searchLocation: searchIndex.searchLocation,
				searchTitle: searchIndex.searchTitle,
				sectionHashes: projection.sectionHashes,
				sourceHash: projection.sourceHash,
				staleAfter: new Date(
					fetchedAt.getTime() +
						this.#config.staleAfterHours * MILLISECONDS_PER_HOUR,
				),
				syncRunId: runId,
				timezone: projection.timezone,
			});

			stats.changedExternalIds.push(projection.externalId);
			if (existing) {
				stats.listingsUpdated += 1;
			} else {
				stats.listingsCreated += 1;
			}
		} catch (error) {
			stats.listingsFailed += 1;
			stats.errors.push({
				error: normalizeError(error),
				externalId,
			});
		}
	}

	private async fetchSections(
		externalId: string,
		listingSummary: unknown,
	): Promise<HostifyListingSections> {
		const detail = await this.#client.listings.get(externalId, {
			guest_guide: 1,
			include_related_objects: 1,
		});
		const [translations, photos, fees, status, guestGuide] = await Promise.all([
			this.optional(() => this.#client.listings.getTranslations(externalId)),
			this.optional(() => this.#client.listings.getPhotos(externalId)),
			this.optional(() => this.#client.listings.getFees(externalId)),
			this.optional(() => this.#client.listings.getStatus(externalId)),
			this.optional(() => this.#client.listings.getGuestGuide(externalId)),
		]);

		return {
			amenities: readField(detail, "amenities"),
			description: readField(detail, "description"),
			details: readField(detail, "details"),
			fees: readField(fees, "fees"),
			guestGuide: readGuestGuide(detail, guestGuide),
			listing: readField(detail, "listing") ?? listingSummary,
			photos: readField(photos, "photos"),
			rooms: readField(detail, "rooms"),
			status: readField(status, "listing_status"),
			translations: readField(translations, "translation"),
		};
	}

	private async optional<T>(request: () => Promise<T>): Promise<T | null> {
		try {
			return await request();
		} catch (error) {
			if (error instanceof HostifyApiError && error.status === 404) {
				return null;
			}

			throw error;
		}
	}

	private async completeRun(
		runId: string,
		stats: HostifyListingSyncStats,
		error?: string,
	): Promise<void> {
		await this.#repository.completeSyncRun(runId, {
			error,
			finishedAt: this.#now(),
			listingsCreated: stats.listingsCreated,
			listingsFailed: stats.listingsFailed,
			listingsSeen: stats.listingsSeen,
			listingsUnchanged: stats.listingsUnchanged,
			listingsUpdated: stats.listingsUpdated,
			status: stats.status,
		});
	}
}

function emptyStats(runId: string): HostifyListingSyncStats {
	return {
		changedExternalIds: [],
		errors: [],
		listingsCreated: 0,
		listingsFailed: 0,
		listingsSeen: 0,
		listingsUnchanged: 0,
		listingsUpdated: 0,
		runId,
		status: "completed",
	};
}

function readListingId(value: unknown): string {
	const record = asRecord(value);
	const id = record.id;

	if (typeof id === "string" || typeof id === "number") {
		return String(id);
	}

	throw new Error("Hostify listing is missing an id");
}

function readField(value: unknown, key: string): unknown {
	return asRecord(value)[key] ?? null;
}

function readGuestGuide(detail: unknown, endpointResponse: unknown): unknown {
	const detailGuide = readField(detail, "guest_guide");
	if (hasGuideContent(detailGuide)) {
		return detailGuide;
	}

	const endpointGuide = readField(endpointResponse, "guest_guide");
	if (hasGuideContent(endpointGuide)) {
		return endpointGuide;
	}

	return hasGuideContent(endpointResponse) ? endpointResponse : null;
}

function hasGuideContent(value: unknown): boolean {
	if (typeof value === "string") {
		return value.trim().length > 0;
	}

	if (Array.isArray(value)) {
		return value.some(hasGuideContent);
	}

	const record = asRecord(value);
	return Object.entries(record).some(
		([key, nested]) =>
			!["env", "listing_id", "success"].includes(key) &&
			nested !== null &&
			nested !== undefined &&
			hasGuideContent(nested),
	);
}

function asRecord(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function derivedFieldsChanged(
	existing: ListingState,
	projection: ListingCacheProjection,
): boolean {
	return (
		existing.active !== projection.active ||
		!sameNullableNumber(existing.latitude, projection.latitude) ||
		!sameNullableNumber(existing.longitude, projection.longitude)
	);
}

function sameNullableNumber(
	left: number | null,
	right: number | null,
): boolean {
	if (left === null || right === null) {
		return left === right;
	}

	return Math.abs(left - right) < 1e-9;
}

function normalizeError(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}

	return "Hostify listing sync failed";
}
