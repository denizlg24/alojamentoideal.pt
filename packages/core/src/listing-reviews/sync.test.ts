import { describe, expect, test } from "bun:test";
import type {
	ListingCacheRepository,
	SyncStateScopeInput,
} from "../listing-cache";
import type { ListingReviewSyncConfig } from "./config";
import type { ListingReviewRepository } from "./repository";
import { HostifyListingReviewSync } from "./sync";

const baseConfig: ListingReviewSyncConfig = {
	batchSize: 10,
	hostifyAccountId: "acct_1",
	leaseMinutes: 10,
	maxPages: 50,
	syncIntervalHours: 24,
};

describe("HostifyListingReviewSync.pollReviews", () => {
	test("skips while listing sync has not completed", async () => {
		const syncRepository = new FakeSyncRepository(false);
		const client = new FakeHostifyClient();
		const sync = new HostifyListingReviewSync({
			client: client as never,
			config: baseConfig,
			now: () => new Date("2026-06-18T12:00:00.000Z"),
			reviewRepository: {} as ListingReviewRepository,
			syncRepository: syncRepository as unknown as ListingCacheRepository,
		});

		const result = await sync.pollReviews("poll");

		expect(result.status).toBe("skipped");
		expect(result.skipReason).toBe("listing_sync_incomplete");
		expect(syncRepository.claims).toBe(0);
		expect(client.reviewListCalls).toBe(0);
		expect(syncRepository.readinessChecks).toEqual([
			{
				accountId: "acct_1",
				provider: "hostify",
				syncType: "listing_cache",
			},
		]);
	});
});

class FakeHostifyClient {
	reviewListCalls = 0;
	readonly reviews = {
		list: async () => {
			this.reviewListCalls += 1;
			return { channels: {}, reviews: [], success: true, total: 0 };
		},
	};
}

class FakeSyncRepository {
	claims = 0;
	readonly readinessChecks: SyncStateScopeInput[] = [];

	constructor(private readonly listingSyncReady: boolean) {}

	async isSyncStateComplete(input: SyncStateScopeInput): Promise<boolean> {
		this.readinessChecks.push(input);
		return this.listingSyncReady;
	}

	async claimSyncState(): Promise<never> {
		this.claims += 1;
		throw new Error("claimSyncState should not be called");
	}
}
