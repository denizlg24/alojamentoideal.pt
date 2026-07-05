import { getDb } from "@workspace/db";
import type {
	HostifyClient,
	HostifyReview,
} from "../integrations/hostify/index";
import { createHostifyClientFromEnv } from "../integrations/hostify/index";
import { ListingCacheRepository } from "../listing-cache/repository";
import { LISTING_SYNC_VERSION } from "../listing-cache/sync-version";
import type { ListingReviewSyncConfig } from "./config";
import { getListingReviewSyncConfigFromSettings } from "./config";
import { buildListingReviewProjection } from "./normalizer";
import { ListingReviewRepository } from "./repository";

const HOSTIFY_PROVIDER = "hostify";
const LISTING_CACHE_SYNC_TYPE = "listing_cache";
const LISTING_REVIEW_SYNC_TYPE = "listing_reviews";
const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;
const MILLISECONDS_PER_MINUTE = 60 * 1000;
// Reviews per request when fetching a single listing. Hostify caps each channel
// bucket at `per_page`, so we page until every channel returns a short page.
const REVIEW_PAGE_SIZE = 100;
// Safety bound on per-listing pagination; no listing is expected to approach it.
const REVIEW_MAX_PAGES_PER_LISTING = 50;

export interface HostifyReviewSyncError {
	error: string;
	externalId: string | null;
}

export interface HostifyReviewSyncStats {
	/**
	 * External ids of listings whose reviews changed this run. The cron uses this
	 * to revalidate exactly the catalog cache entries affected by review updates.
	 */
	changedListingExternalIds: string[];
	errors: HostifyReviewSyncError[];
	listingsSeen: number;
	reviewsFailed: number;
	reviewsSeen: number;
	runId: string;
	status: "completed" | "completed_with_errors" | "failed";
}

export interface HostifyReviewPollResult {
	data: HostifyReviewSyncStats | null;
	nextPage: number | null;
	nextRunAt: string | null;
	page: number | null;
	skipReason?: "listing_sync_incomplete";
	status: "advanced" | "completed" | "failed" | "skipped";
}

interface ChannelReview {
	channel: string;
	review: HostifyReview;
}

interface HostifyListingReviewSyncOptions {
	client: Pick<HostifyClient, "reviews">;
	config: ListingReviewSyncConfig;
	now?: () => Date;
	reviewRepository: ListingReviewRepository;
	syncRepository: ListingCacheRepository;
}

export async function createHostifyListingReviewSyncFromEnv() {
	return new HostifyListingReviewSync({
		client: createHostifyClientFromEnv(),
		config: await getListingReviewSyncConfigFromSettings(),
		reviewRepository: new ListingReviewRepository(getDb()),
		syncRepository: new ListingCacheRepository(getDb()),
	});
}

export class HostifyListingReviewSync {
	readonly #client: Pick<HostifyClient, "reviews">;
	readonly #config: ListingReviewSyncConfig;
	readonly #now: () => Date;
	readonly #reviews: ListingReviewRepository;
	readonly #sync: ListingCacheRepository;

	constructor(options: HostifyListingReviewSyncOptions) {
		this.#client = options.client;
		this.#config = options.config;
		this.#now = options.now ?? (() => new Date());
		this.#reviews = options.reviewRepository;
		this.#sync = options.syncRepository;
	}

	async pollReviews(trigger = "poll"): Promise<HostifyReviewPollResult> {
		const now = this.#now();
		const listingSyncReady = await this.#sync.isSyncStateComplete({
			accountId: this.#config.hostifyAccountId,
			provider: HOSTIFY_PROVIDER,
			syncType: LISTING_CACHE_SYNC_TYPE,
		});

		if (!listingSyncReady) {
			return skippedPollResult("listing_sync_incomplete");
		}

		const newRunId = crypto.randomUUID();
		const claim = await this.#sync.claimSyncState({
			accountId: this.#config.hostifyAccountId,
			leaseExpiresAt: new Date(
				now.getTime() + this.#config.leaseMinutes * MILLISECONDS_PER_MINUTE,
			),
			newRunId,
			now,
			provider: HOSTIFY_PROVIDER,
			syncType: LISTING_REVIEW_SYNC_TYPE,
			versionHash: LISTING_SYNC_VERSION,
		});

		if (!claim) {
			return skippedPollResult();
		}

		const runId = claim.activeRunId;
		await this.#sync.createSyncRun({
			id: runId,
			provider: HOSTIFY_PROVIDER,
			status: "running",
			syncType: LISTING_REVIEW_SYNC_TYPE,
			trigger,
		});

		const stats = emptyStats(runId);

		try {
			const listingExternalIds = await this.#sync.listListingExternalIds({
				accountId: this.#config.hostifyAccountId,
				limit: this.#config.batchSize,
				offset: (claim.nextPage - 1) * this.#config.batchSize,
				provider: HOSTIFY_PROVIDER,
			});
			stats.listingsSeen = listingExternalIds.length;

			const changed = new Set<string>();
			for (const listingExternalId of listingExternalIds) {
				const reviews = await this.fetchListingReviews(listingExternalId);
				for (const { channel, review } of reviews) {
					if (isEmptyReview(review)) {
						continue;
					}

					stats.reviewsSeen += 1;
					await this.syncReview(
						runId,
						stats,
						changed,
						listingExternalId,
						channel,
						review,
					);
				}
			}

			const changedListingExternalIds = [...changed];
			await this.#reviews.recomputeSummaries(
				HOSTIFY_PROVIDER,
				this.#config.hostifyAccountId,
				changedListingExternalIds,
			);
			stats.changedListingExternalIds = changedListingExternalIds;

			const totals = await this.#sync.incrementSyncRunStats(runId, {
				listingsCreated: 0,
				listingsFailed: stats.reviewsFailed,
				listingsSeen: stats.listingsSeen,
				listingsUnchanged: 0,
				listingsUpdated: 0,
			});

			const finished =
				listingExternalIds.length === 0 ||
				listingExternalIds.length < this.#config.batchSize ||
				claim.nextPage >= this.#config.maxPages;
			const finishedAt = this.#now();

			stats.status =
				totals.listingsFailed > 0 ? "completed_with_errors" : "completed";

			if (finished) {
				await this.#sync.finishSyncRun(runId, {
					finishedAt,
					status: stats.status,
				});
				const nextRunAt = new Date(
					finishedAt.getTime() +
						this.#config.syncIntervalHours * MILLISECONDS_PER_HOUR,
				);
				await this.#sync.completeSyncState({
					activeRunId: runId,
					error:
						stats.status === "completed_with_errors"
							? `${stats.reviewsFailed} review(s) failed`
							: undefined,
					nextRunAt,
					now: finishedAt,
					provider: HOSTIFY_PROVIDER,
					versionHash: LISTING_SYNC_VERSION,
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
			await this.#sync.advanceSyncState({
				activeRunId: runId,
				nextPage,
				now: finishedAt,
				provider: HOSTIFY_PROVIDER,
			});

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
			await this.#sync.finishSyncRun(runId, {
				error: message,
				finishedAt: failedAt,
				status: stats.status,
			});
			await this.#sync.failSyncState({
				activeRunId: runId,
				error: message,
				nextRunAt: new Date(
					failedAt.getTime() +
						this.#config.leaseMinutes * MILLISECONDS_PER_MINUTE,
				),
				now: failedAt,
				provider: HOSTIFY_PROVIDER,
			});

			throw error;
		}
	}

	/**
	 * Fetches every review for a listing, labelled by channel. Reads the
	 * `channels` map (the flat `reviews` array carries no channel) and pages until
	 * each channel bucket returns a short page, deduping by channel + review id.
	 */
	private async fetchListingReviews(
		listingExternalId: string,
	): Promise<ChannelReview[]> {
		const collected = new Map<string, ChannelReview>();

		for (let page = 1; page <= REVIEW_MAX_PAGES_PER_LISTING; page += 1) {
			const response = await this.#client.reviews.list({
				listing_id: listingExternalId,
				page,
				per_page: REVIEW_PAGE_SIZE,
			});

			const channels = response.channels ?? {};
			let maxBucketSize = 0;
			for (const [channel, bucket] of Object.entries(channels)) {
				maxBucketSize = Math.max(maxBucketSize, bucket.length);
				for (const review of bucket) {
					const reviewId = readReviewId(review);
					if (reviewId === null) {
						continue;
					}
					collected.set(`${channel}:${reviewId}`, { channel, review });
				}
			}

			if (maxBucketSize < REVIEW_PAGE_SIZE) {
				break;
			}
		}

		return [...collected.values()];
	}

	private async syncReview(
		runId: string,
		stats: HostifyReviewSyncStats,
		changed: Set<string>,
		listingExternalId: string,
		channel: string,
		review: HostifyReview,
	): Promise<void> {
		try {
			const projection = buildListingReviewProjection(review, {
				channel,
				listingExternalId,
			});

			await this.#reviews.upsertReview({
				accountId: this.#config.hostifyAccountId,
				accuracyRating: projection.accuracyRating,
				channel: projection.channel,
				channelListingExternalId: projection.channelListingExternalId,
				channelReviewId: projection.channelReviewId,
				checkinRating: projection.checkinRating,
				cleanRating: projection.cleanRating,
				comments: projection.comments,
				communicationRating: projection.communicationRating,
				externalId: projection.externalId,
				guestId: projection.guestId,
				guestName: null,
				language: null,
				listingExternalId: projection.listingExternalId,
				locationRating: projection.locationRating,
				provider: HOSTIFY_PROVIDER,
				rating: projection.rating,
				raw: projection.raw,
				reservationId: projection.reservationId,
				reviewedAt: projection.reviewedAt,
				source: projection.source,
				status: "published",
				syncRunId: runId,
				valueRating: projection.valueRating,
			});

			changed.add(projection.listingExternalId);
		} catch (error) {
			stats.reviewsFailed += 1;
			stats.errors.push({
				error: normalizeError(error),
				externalId: readReviewId(review),
			});
		}
	}
}

function emptyStats(runId: string): HostifyReviewSyncStats {
	return {
		changedListingExternalIds: [],
		errors: [],
		listingsSeen: 0,
		reviewsFailed: 0,
		reviewsSeen: 0,
		runId,
		status: "completed",
	};
}

function skippedPollResult(
	skipReason?: HostifyReviewPollResult["skipReason"],
): HostifyReviewPollResult {
	return {
		data: null,
		nextPage: null,
		nextRunAt: null,
		page: null,
		skipReason,
		status: "skipped",
	};
}

/**
 * Hostify returns placeholder rows for reviews that were left but never
 * published (no rating and no text). They carry no signal, so the sync skips
 * them rather than persisting empty reviews.
 */
function isEmptyReview(review: HostifyReview): boolean {
	const hasRating = typeof review.rating === "number";
	const hasComments =
		typeof review.comments === "string" && review.comments.trim().length > 0;
	return !hasRating && !hasComments;
}

function readReviewId(value: HostifyReview): string | null {
	const id = value.id;
	return typeof id === "string" || typeof id === "number" ? String(id) : null;
}

function normalizeError(error: unknown): string {
	return error instanceof Error ? error.message : "Hostify review sync failed";
}
