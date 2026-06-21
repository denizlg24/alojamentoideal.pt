import { describe, expect, test } from "bun:test";
import type { HostifyReview } from "../integrations/hostify";
import type {
	AdvanceSyncStateInput,
	ClaimedSyncState,
	ClaimSyncStateInput,
	CompleteSyncStateInput,
	FailSyncStateInput,
	FinishSyncRunInput,
	IncrementSyncRunStatsInput,
	ListingCacheRepository,
	SyncRunInput,
	SyncStateScopeInput,
} from "../listing-cache";
import type { ListingReviewSyncConfig } from "./config";
import type { ListingReviewRepository, UpsertReviewInput } from "./repository";
import { HostifyListingReviewSync } from "./sync";

const baseConfig: ListingReviewSyncConfig = {
	batchSize: 2,
	hostifyAccountId: "acct_1",
	leaseMinutes: 10,
	maxPages: 50,
	syncIntervalHours: 24,
};

const syncNow = new Date("2026-06-18T12:00:00.000Z");

describe("HostifyListingReviewSync.pollReviews", () => {
	test("skips while listing sync has not completed", async () => {
		const syncRepository = new FakeSyncRepository({ listingSyncReady: false });
		const client = new FakeHostifyClient();
		const reviewRepository = new FakeReviewRepository();
		const sync = createSync({ client, reviewRepository, syncRepository });

		const result = await sync.pollReviews("poll");

		expect(result.status).toBe("skipped");
		expect(result.skipReason).toBe("listing_sync_incomplete");
		expect(syncRepository.claims).toHaveLength(0);
		expect(client.reviewListCalls).toBe(0);
		expect(syncRepository.readinessChecks).toEqual([
			{
				accountId: "acct_1",
				provider: "hostify",
				syncType: "listing_cache",
			},
		]);
	});

	test("processes one listing batch and advances the cursor", async () => {
		const syncRepository = new FakeSyncRepository({
			listingExternalIds: ["1", "2", "3"],
			listingSyncReady: true,
		});
		const client = new FakeHostifyClient({
			"1": [reviewFixture("review_1", "1")],
			"2": [reviewFixture("review_2", "2")],
		});
		const reviewRepository = new FakeReviewRepository();
		const sync = createSync({ client, reviewRepository, syncRepository });

		const result = await sync.pollReviews("poll");

		expect(result.status).toBe("advanced");
		expect(result.page).toBe(1);
		expect(result.nextPage).toBe(2);
		expect(result.data?.listingsSeen).toBe(2);
		expect(result.data?.reviewsSeen).toBe(2);
		expect(result.data?.changedListingExternalIds).toEqual(["1", "2"]);
		expect(syncRepository.listRequests).toEqual([
			{
				accountId: "acct_1",
				limit: 2,
				offset: 0,
				provider: "hostify",
			},
		]);
		expect(client.reviewQueries).toEqual([
			{ listing_id: "1", page: 1, per_page: 100 },
			{ listing_id: "2", page: 1, per_page: 100 },
		]);
		expect(reviewRepository.upserts.map((input) => input.externalId)).toEqual([
			"review_1",
			"review_2",
		]);
		expect(reviewRepository.recomputeInputs).toEqual([
			{
				accountId: "acct_1",
				listingExternalIds: ["1", "2"],
				provider: "hostify",
			},
		]);
		expect(syncRepository.state.nextPage).toBe(2);
		expect(syncRepository.state.status).toBe("running");
		expect(syncRepository.incrementInputs).toEqual([
			{
				listingsCreated: 0,
				listingsFailed: 0,
				listingsSeen: 2,
				listingsUnchanged: 0,
				listingsUpdated: 0,
			},
		]);
	});

	test("completes the cycle when the listing batch is short", async () => {
		const syncRepository = new FakeSyncRepository({
			listingExternalIds: ["1"],
			listingSyncReady: true,
		});
		const client = new FakeHostifyClient({
			"1": [reviewFixture("review_1", "1")],
		});
		const reviewRepository = new FakeReviewRepository();
		const sync = createSync({ client, reviewRepository, syncRepository });

		const result = await sync.pollReviews("poll");

		expect(result.status).toBe("completed");
		expect(result.page).toBe(1);
		expect(result.nextPage).toBeNull();
		expect(result.nextRunAt).toBe("2026-06-19T12:00:00.000Z");
		expect(result.data?.listingsSeen).toBe(1);
		expect(result.data?.reviewsSeen).toBe(1);
		expect(syncRepository.finishInputs).toEqual([
			{
				finishedAt: syncNow,
				status: "completed",
			},
		]);
		expect(syncRepository.completeInputs).toHaveLength(1);
		expect(syncRepository.completeInputs[0]?.nextRunAt.toISOString()).toBe(
			"2026-06-19T12:00:00.000Z",
		);
		expect(syncRepository.state.nextPage).toBe(1);
		expect(syncRepository.state.status).toBe("complete");
	});
});

function createSync({
	client,
	reviewRepository,
	syncRepository,
}: {
	client: FakeHostifyClient;
	reviewRepository: FakeReviewRepository;
	syncRepository: FakeSyncRepository;
}): HostifyListingReviewSync {
	return new HostifyListingReviewSync({
		client: client as never,
		config: baseConfig,
		now: () => syncNow,
		reviewRepository: reviewRepository as unknown as ListingReviewRepository,
		syncRepository: syncRepository as unknown as ListingCacheRepository,
	});
}

function reviewFixture(id: string, listingExternalId: string): HostifyReview {
	return {
		comments: `Review ${id}`,
		created: "2026-06-01T00:00:00.000Z",
		id,
		listing_id: listingExternalId,
		parent_listing_id: listingExternalId,
		rating: 5,
	} satisfies HostifyReview;
}

class FakeHostifyClient {
	readonly reviewQueries: Array<{
		listing_id: string | number;
		page: number;
		per_page: number;
	}> = [];
	readonly reviews = {
		list: async (query: {
			listing_id: string | number;
			page: number;
			per_page: number;
		}) => {
			this.reviewQueries.push(query);
			const reviews =
				query.page === 1
					? (this.reviewsByListing[String(query.listing_id)] ?? [])
					: [];

			return {
				channels: reviews.length > 0 ? { airbnb: reviews } : {},
				reviews,
				success: true,
				total: reviews.length,
			};
		},
	};

	constructor(
		private readonly reviewsByListing: Record<string, HostifyReview[]> = {},
	) {}

	get reviewListCalls(): number {
		return this.reviewQueries.length;
	}
}

class FakeReviewRepository {
	readonly recomputeInputs: Array<{
		accountId: string;
		listingExternalIds: string[];
		provider: string;
	}> = [];
	readonly upserts: UpsertReviewInput[] = [];

	async upsertReview(input: UpsertReviewInput): Promise<void> {
		this.upserts.push(input);
	}

	async recomputeSummaries(
		provider: string,
		accountId: string,
		listingExternalIds: string[],
	): Promise<void> {
		this.recomputeInputs.push({ accountId, listingExternalIds, provider });
	}
}

class FakeSyncRepository {
	readonly advanceInputs: AdvanceSyncStateInput[] = [];
	readonly claims: ClaimSyncStateInput[] = [];
	readonly completeInputs: CompleteSyncStateInput[] = [];
	readonly failInputs: FailSyncStateInput[] = [];
	readonly finishInputs: FinishSyncRunInput[] = [];
	readonly incrementInputs: IncrementSyncRunStatsInput[] = [];
	readonly listRequests: Array<{
		accountId: string;
		limit: number;
		offset: number;
		provider: string;
	}> = [];
	readonly readinessChecks: SyncStateScopeInput[] = [];
	readonly runs: SyncRunInput[] = [];
	state: {
		activeRunId: string | null;
		nextPage: number;
		status: "complete" | "failed" | "idle" | "running";
	} = {
		activeRunId: null,
		nextPage: 1,
		status: "idle",
	};

	constructor(
		private readonly options: {
			listingExternalIds?: string[];
			listingSyncReady: boolean;
		},
	) {}

	async isSyncStateComplete(input: SyncStateScopeInput): Promise<boolean> {
		this.readinessChecks.push(input);
		return this.options.listingSyncReady;
	}

	async claimSyncState(
		input: ClaimSyncStateInput,
	): Promise<ClaimedSyncState | null> {
		this.claims.push(input);
		const startedNewCycle = this.state.status !== "running";
		if (startedNewCycle) {
			this.state.activeRunId = input.newRunId;
			this.state.nextPage = 1;
		}
		this.state.status = "running";

		return {
			activeRunId: this.state.activeRunId ?? input.newRunId,
			nextPage: this.state.nextPage,
			startedNewCycle,
		};
	}

	async createSyncRun(input: SyncRunInput): Promise<void> {
		this.runs.push(input);
	}

	async listListingExternalIds(input: {
		accountId: string;
		limit: number;
		offset: number;
		provider: string;
	}): Promise<string[]> {
		this.listRequests.push(input);
		return (this.options.listingExternalIds ?? []).slice(
			input.offset,
			input.offset + input.limit,
		);
	}

	async incrementSyncRunStats(
		_id: string,
		input: IncrementSyncRunStatsInput,
	): Promise<{ listingsFailed: number }> {
		this.incrementInputs.push(input);
		return { listingsFailed: input.listingsFailed };
	}

	async advanceSyncState(input: AdvanceSyncStateInput): Promise<void> {
		this.advanceInputs.push(input);
		this.state.nextPage = input.nextPage;
		this.state.status = "running";
	}

	async finishSyncRun(_id: string, input: FinishSyncRunInput): Promise<void> {
		this.finishInputs.push(input);
	}

	async completeSyncState(input: CompleteSyncStateInput): Promise<void> {
		this.completeInputs.push(input);
		this.state.activeRunId = null;
		this.state.nextPage = 1;
		this.state.status = "complete";
	}

	async failSyncState(input: FailSyncStateInput): Promise<void> {
		this.failInputs.push(input);
		this.state.status = "failed";
	}
}
