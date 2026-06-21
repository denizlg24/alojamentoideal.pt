import { describe, expect, test } from "bun:test";
import type {
	ClaimedSyncState,
	ClaimSyncStateInput,
	IncrementSyncRunStatsInput,
	ListingCacheRepository,
	SyncRunInput,
	SyncStateScopeInput,
} from "../listing-cache";
import type { AccommodationsConfig } from "./config";
import { NightlyPriceSync } from "./nightly-price-sync";
import type {
	AccommodationPricingRepository,
	AccommodationScope,
	UpsertNightInput,
} from "./repository";

const baseConfig: AccommodationsConfig = {
	availabilityCacheTtlSeconds: 60,
	currency: "EUR",
	hostifyAccountId: "acct_1",
	liveSearchCandidateLimit: 100,
	nightlyPriceSyncBatchSize: 2,
	nightlyPriceSyncDays: 2,
	nightlyPriceSyncIntervalHours: 24,
	nightlyPriceSyncLeaseMinutes: 10,
	nightlyPriceSyncMaxListings: 100,
	nightlyPriceSyncMaxPages: 50,
	quoteCacheTtlSeconds: 300,
};

describe("NightlyPriceSync.pollPrices", () => {
	test("skips while listing sync has not completed", async () => {
		const pricing = new FakePricingRepository(["1", "2"]);
		const syncRepository = new FakeSyncRepository(false);
		const client = new FakeHostifyCalendarClient();
		const sync = createSync({ client, pricing, syncRepository });

		const result = await sync.pollPrices("poll");

		expect(result.status).toBe("skipped");
		expect(result.skipReason).toBe("listing_sync_incomplete");
		expect(syncRepository.claims).toHaveLength(0);
		expect(pricing.listRequests).toHaveLength(0);
		expect(client.calendarQueries).toHaveLength(0);
	});

	test("processes one listing batch and advances the cursor", async () => {
		const pricing = new FakePricingRepository(["1", "2", "3"]);
		const syncRepository = new FakeSyncRepository(true);
		const client = new FakeHostifyCalendarClient();
		const sync = createSync({ client, pricing, syncRepository });

		const result = await sync.pollPrices("poll");

		expect(result.status).toBe("advanced");
		expect(result.page).toBe(1);
		expect(result.nextPage).toBe(2);
		expect(result.data?.listingsSeen).toBe(2);
		expect(result.data?.listingsSynced).toBe(2);
		expect(result.data?.nightsSynced).toBe(2);
		expect(pricing.listRequests).toEqual([{ limit: 2, offset: 0 }]);
		expect(pricing.upserts.map((input) => input.listingExternalId)).toEqual([
			"1",
			"2",
		]);
		expect(
			pricing.upserts.every((input) => input.syncRunId === result.data?.runId),
		).toBe(true);
		expect(syncRepository.state.nextPage).toBe(2);
		expect(syncRepository.state.status).toBe("running");
		expect(syncRepository.incrementInputs).toEqual([
			{
				listingsCreated: 0,
				listingsFailed: 0,
				listingsSeen: 2,
				listingsUnchanged: 0,
				listingsUpdated: 2,
			},
		]);
	});
});

function createSync({
	client,
	pricing,
	syncRepository,
}: {
	client: FakeHostifyCalendarClient;
	pricing: FakePricingRepository;
	syncRepository: FakeSyncRepository;
}): NightlyPriceSync {
	return new NightlyPriceSync({
		client: client as never,
		config: baseConfig,
		now: () => new Date("2026-06-18T12:00:00.000Z"),
		repository: pricing as unknown as AccommodationPricingRepository,
		syncRepository: syncRepository as unknown as ListingCacheRepository,
	});
}

class FakeHostifyCalendarClient {
	readonly calendarQueries: Array<{
		listing_id: string | number;
		page: number;
		per_page: number;
	}> = [];
	readonly calendar = {
		list: async (query: {
			listing_id: string | number;
			page: number;
			per_page: number;
		}) => {
			this.calendarQueries.push(query);
			if (query.page > 1) {
				return { calendar: [], listing_id: query.listing_id, success: true };
			}

			return {
				calendar: [
					{
						base_price: 100,
						currency: "EUR",
						date: "2026-06-18",
						id: `${query.listing_id}:2026-06-18`,
						is_manual_blocked: 0,
						is_preparation_blocked: 0,
						min_stay: 1,
						price: 100,
						reservation_id: null,
						status: "available",
					},
				],
				listing_id: query.listing_id,
				success: true,
			};
		},
	};
}

class FakePricingRepository {
	readonly listRequests: Array<{ limit: number; offset: number }> = [];
	readonly upserts: UpsertNightInput[] = [];

	constructor(private readonly activeIds: string[]) {}

	async listActiveListingIds(
		_scope: AccommodationScope,
		input: { limit: number; offset?: number },
	): Promise<string[]> {
		const offset = input.offset ?? 0;
		this.listRequests.push({ limit: input.limit, offset });
		return this.activeIds.slice(offset, offset + input.limit);
	}

	async upsertNights(
		_scope: AccommodationScope,
		inputs: UpsertNightInput[],
	): Promise<void> {
		this.upserts.push(...inputs);
	}
}

class FakeSyncRepository {
	readonly claims: ClaimSyncStateInput[] = [];
	readonly incrementInputs: IncrementSyncRunStatsInput[] = [];
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

	constructor(private readonly listingSyncReady: boolean) {}

	async isSyncStateComplete(input: SyncStateScopeInput): Promise<boolean> {
		this.readinessChecks.push(input);
		return this.listingSyncReady;
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

	async incrementSyncRunStats(
		_id: string,
		input: IncrementSyncRunStatsInput,
	): Promise<{ listingsFailed: number }> {
		this.incrementInputs.push(input);
		return { listingsFailed: input.listingsFailed };
	}

	async advanceSyncState(input: { nextPage: number }): Promise<void> {
		this.state.nextPage = input.nextPage;
		this.state.status = "running";
	}

	async finishSyncRun(): Promise<void> {}
	async completeSyncState(): Promise<void> {
		this.state.status = "complete";
	}
	async failSyncState(): Promise<void> {
		this.state.status = "failed";
	}
}
