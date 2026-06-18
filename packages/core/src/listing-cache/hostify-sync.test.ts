import { describe, expect, test } from "bun:test";
import type { ListingCacheConfig } from "./config";
import { HostifyListingCacheSync } from "./hostify-sync";
import type {
	AdvanceSyncStateInput,
	ClaimedSyncState,
	ClaimSyncStateInput,
	CompleteSyncStateInput,
	FailSyncStateInput,
	IncrementSyncRunStatsInput,
	ListingCacheRepository,
	SyncRunInput,
	UpsertListingInput,
} from "./repository";

const baseConfig: ListingCacheConfig = {
	hostifyAccountId: "acct_1",
	incrementalBatchSize: 2,
	incrementalLeaseMinutes: 10,
	incrementalSyncIntervalHours: 24,
	llmEnabled: false,
	openaiModel: "test-model",
	staleAfterHours: 24,
	syncMaxPages: 50,
	syncPerPage: 50,
};

describe("HostifyListingCacheSync.pollListings", () => {
	test("processes one page and advances the cursor", async () => {
		const repository = new FakeListingCacheRepository();
		const client = new FakeHostifyClient({
			1: [listing("1"), listing("2")],
		});
		const sync = createSync({ client, repository });

		const result = await sync.pollListings("poll");

		expect(result.status).toBe("advanced");
		expect(result.page).toBe(1);
		expect(result.nextPage).toBe(2);
		expect(client.listQueries).toEqual([{ page: 1, per_page: 2 }]);
		expect(repository.upserts.map((upsert) => upsert.externalId)).toEqual([
			"1",
			"2",
		]);
		expect(repository.state.nextPage).toBe(2);
		expect(repository.state.status).toBe("running");
	});

	test("completes the cycle and defers later polls until the next run time", async () => {
		const repository = new FakeListingCacheRepository();
		const client = new FakeHostifyClient({
			1: [listing("1")],
		});
		const sync = createSync({ client, repository });

		const completed = await sync.pollListings("poll");
		const skipped = await sync.pollListings("poll");

		expect(completed.status).toBe("completed");
		expect(completed.nextPage).toBeNull();
		expect(repository.state.status).toBe("complete");
		expect(repository.state.nextPage).toBe(1);
		expect(repository.state.nextRunAt?.toISOString()).toBe(
			"2026-06-19T12:00:00.000Z",
		);
		expect(skipped.status).toBe("skipped");
		expect(client.listQueries).toEqual([{ page: 1, per_page: 2 }]);
	});
});

function createSync({
	client,
	repository,
}: {
	client: FakeHostifyClient;
	repository: FakeListingCacheRepository;
}) {
	return new HostifyListingCacheSync({
		client: client as never,
		config: baseConfig,
		now: () => new Date("2026-06-18T12:00:00.000Z"),
		processor: {
			enabled: false,
			async process(input) {
				return {
					content: input.fallback,
					error: null,
					processedAt: null,
					processedSourceHash: null,
					status: "skipped",
				};
			},
		},
		repository: repository as unknown as ListingCacheRepository,
	});
}

function listing(id: string) {
	return {
		active: true,
		city: "Lisbon",
		description: `Description ${id}`,
		id,
		name: `Listing ${id}`,
	};
}

class FakeHostifyClient {
	readonly listQueries: Array<{ page: number; per_page: number }> = [];
	readonly listings = {
		get: async (id: string) => ({ listing: listing(id) }),
		getFees: async () => ({ fees: [] }),
		getGuestGuide: async () => ({ success: true }),
		getPhotos: async () => ({ photos: [] }),
		getStatus: async () => ({ listing_status: "Clean" }),
		getTranslations: async () => ({ translation: [] }),
		list: async (query: { page: number; per_page: number }) => {
			this.listQueries.push({ page: query.page, per_page: query.per_page });
			return { listings: this.pages[query.page] ?? [] };
		},
	};

	constructor(private readonly pages: Record<number, unknown[]>) {}
}

class FakeListingCacheRepository {
	readonly runs: SyncRunInput[] = [];
	readonly upserts: UpsertListingInput[] = [];
	state: {
		activeRunId: string | null;
		leaseExpiresAt: Date | null;
		nextPage: number;
		nextRunAt: Date | null;
		status: "complete" | "failed" | "idle" | "running";
	} = {
		activeRunId: null,
		leaseExpiresAt: null,
		nextPage: 1,
		nextRunAt: null,
		status: "idle",
	};

	async claimSyncState(
		input: ClaimSyncStateInput,
	): Promise<ClaimedSyncState | null> {
		if (this.state.nextRunAt && this.state.nextRunAt > input.now) {
			return null;
		}
		if (this.state.leaseExpiresAt && this.state.leaseExpiresAt > input.now) {
			return null;
		}

		const startedNewCycle = this.state.status !== "running";
		if (startedNewCycle) {
			this.state.activeRunId = input.newRunId;
			this.state.nextPage = 1;
		}

		this.state.leaseExpiresAt = input.leaseExpiresAt;
		this.state.status = "running";

		return {
			activeRunId: this.state.activeRunId ?? input.newRunId,
			nextPage: this.state.nextPage,
			startedNewCycle,
		};
	}

	async createSyncRun(input: SyncRunInput): Promise<void> {
		if (!this.runs.some((run) => run.id === input.id)) {
			this.runs.push(input);
		}
	}

	async findListingState(): Promise<null> {
		return null;
	}

	async upsertListing(input: UpsertListingInput): Promise<void> {
		this.upserts.push(input);
	}

	async incrementSyncRunStats(_id: string, input: IncrementSyncRunStatsInput) {
		return { listingsFailed: input.listingsFailed };
	}

	async finishSyncRun() {}

	async advanceSyncState(input: AdvanceSyncStateInput): Promise<void> {
		this.state.leaseExpiresAt = null;
		this.state.nextPage = input.nextPage;
		this.state.nextRunAt = input.now;
		this.state.status = "running";
	}

	async completeSyncState(input: CompleteSyncStateInput): Promise<void> {
		this.state.activeRunId = null;
		this.state.leaseExpiresAt = null;
		this.state.nextPage = 1;
		this.state.nextRunAt = input.nextRunAt;
		this.state.status = input.error ? "failed" : "complete";
	}

	async failSyncState(input: FailSyncStateInput): Promise<void> {
		this.state.leaseExpiresAt = null;
		this.state.nextRunAt = input.nextRunAt;
		this.state.status = "failed";
	}
}
