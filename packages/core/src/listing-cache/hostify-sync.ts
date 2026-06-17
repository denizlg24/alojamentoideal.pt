import { getDb } from "@workspace/db";
import type { HostifyClient } from "../integrations/hostify/index";
import {
	createHostifyClientFromEnv,
	HostifyApiError,
} from "../integrations/hostify/index";
import type { ListingCacheConfig } from "./config";
import { getListingCacheConfig } from "./config";
import {
	buildListingCacheProjection,
	type HostifyListingSections,
} from "./normalizer";
import {
	createListingContentProcessor,
	type ListingContentProcessor,
	listingProcessingInput,
} from "./processor";
import { ListingCacheRepository } from "./repository";

const HOSTIFY_PROVIDER = "hostify";
const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;

export interface HostifyListingSyncStats {
	errors: SyncListingError[];
	listingsCreated: number;
	listingsFailed: number;
	listingsSeen: number;
	listingsUnchanged: number;
	listingsUpdated: number;
	runId: string;
	status: "completed" | "completed_with_errors" | "failed";
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

export function createHostifyListingCacheSyncFromEnv() {
	const config = getListingCacheConfig();

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
			syncType: "listing_cache",
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
			const projection = buildListingCacheProjection(sections);
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

			if (!sourceChanged && !processingNeeded) {
				stats.listingsUnchanged += 1;
				return;
			}

			const processing = await this.#processor.process(
				listingProcessingInput(projection),
			);
			const fetchedAt = this.#now();

			await this.#repository.upsertListing({
				accountId: this.#config.hostifyAccountId,
				active: projection.active,
				bathrooms: projection.bathrooms,
				bedrooms: projection.bedrooms,
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
				sectionHashes: projection.sectionHashes,
				sourceHash: projection.sourceHash,
				staleAfter: new Date(
					fetchedAt.getTime() +
						this.#config.staleAfterHours * MILLISECONDS_PER_HOUR,
				),
				syncRunId: runId,
				timezone: projection.timezone,
			});

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
		});
		const [translations, photos, fees, status, guestGuide] = await Promise.all([
			this.optional(() => this.#client.listings.getTranslations(externalId)),
			this.optional(() => this.#client.listings.getPhotos(externalId)),
			this.optional(() => this.#client.listings.getFees(externalId)),
			this.optional(() => this.#client.listings.getStatus(externalId)),
			this.optional(() => this.#client.listings.getGuestGuide(externalId)),
		]);

		return {
			fees: readField(fees, "fees"),
			guestGuide,
			listing: readField(detail, "listing") ?? listingSummary,
			photos: readField(photos, "photos"),
			status: readField(status, "status"),
			translations: readField(translations, "translations"),
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

function asRecord(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function normalizeError(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}

	return "Hostify listing sync failed";
}
