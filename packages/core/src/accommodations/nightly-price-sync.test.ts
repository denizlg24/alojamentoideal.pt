import { describe, expect, test } from "bun:test";
import type {
	ClaimedSyncState,
	ClaimSyncStateInput,
	CompleteSyncStateInput,
	IncrementSyncRunStatsInput,
	ListingCacheRepository,
	SyncRunInput,
	SyncStateScopeInput,
} from "../listing-cache";
import { LISTING_SYNC_VERSION } from "../listing-cache/sync-version";
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
	syncVersion: LISTING_SYNC_VERSION,
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
		expect(pricing.upserts[0]).toMatchObject({
			active: true,
			basePrice: 100,
			cta: false,
			ctd: false,
		});
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

	test("marks only v2 'available' nights active and maps cta/ctd", async () => {
		const pricing = new FakePricingRepository(["1"]);
		const syncRepository = new FakeSyncRepository(true);
		const sync = new NightlyPriceSync({
			client: new FakeV2StatusClient() as never,
			config: baseConfig,
			now: () => new Date("2026-06-18T12:00:00.000Z"),
			repository: pricing as unknown as AccommodationPricingRepository,
			syncRepository: syncRepository as unknown as ListingCacheRepository,
		});

		await sync.pollPrices("poll");

		const byDate = new Map(pricing.upserts.map((input) => [input.date, input]));
		expect(byDate.get("2026-06-18")).toMatchObject({
			active: true,
			basePrice: 90,
			cta: false,
			ctd: false,
		});
		// Booked reservation night: closed even though it has a price.
		expect(byDate.get("2026-06-19")).toMatchObject({
			active: false,
			cta: true,
		});
		// Manually blocked night with no reservation: still closed under v2.
		expect(byDate.get("2026-06-20")).toMatchObject({
			active: false,
			ctd: true,
		});
	});

	test("normalizes v2 calendar euro symbols before persisting currency", async () => {
		const pricing = new FakePricingRepository(["1"]);
		const syncRepository = new FakeSyncRepository(true);
		const sync = new NightlyPriceSync({
			client: new FakeV2CurrencySymbolClient() as never,
			config: baseConfig,
			now: () => new Date("2026-06-18T12:00:00.000Z"),
			repository: pricing as unknown as AccommodationPricingRepository,
			syncRepository: syncRepository as unknown as ListingCacheRepository,
		});

		await sync.pollPrices("poll");

		expect(pricing.upserts[0]?.currency).toBe("EUR");
	});

	test("dedupes and terminates when v2 repeats the whole window per page", async () => {
		const pricing = new FakePricingRepository(["1"]);
		const syncRepository = new FakeSyncRepository(true);
		const client = new FakeV2RepeatingClient();
		const sync = new NightlyPriceSync({
			client: client as never,
			config: baseConfig,
			now: () => new Date("2026-06-18T12:00:00.000Z"),
			repository: pricing as unknown as AccommodationPricingRepository,
			syncRepository: syncRepository as unknown as ListingCacheRepository,
		});

		const result = await sync.pollPrices("poll");

		// Two distinct dates, not four: the repeated second page is deduped away.
		expect(result.data?.nightsSynced).toBe(2);
		expect(pricing.upserts.map((input) => input.date)).toEqual([
			"2026-06-18",
			"2026-06-19",
		]);
		// Stops after the first repeat page rather than walking every allowed page.
		expect(client.pagesFetched).toBe(2);
	});

	test("passes the current sync version to claim and completion", async () => {
		const pricing = new FakePricingRepository(["1"]);
		const syncRepository = new FakeSyncRepository(true);
		const client = new FakeHostifyCalendarClient();
		const sync = createSync({ client, pricing, syncRepository });

		const result = await sync.pollPrices("poll");

		expect(result.status).toBe("completed");
		expect(syncRepository.claims[0]?.versionHash).toBe(LISTING_SYNC_VERSION);
		expect(syncRepository.completeInputs[0]?.versionHash).toBe(
			LISTING_SYNC_VERSION,
		);
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
						basePrice: 100,
						cta: false,
						ctd: false,
						currency: "EUR",
						date: "2026-06-18",
						defaultStatus: "available",
						id: `${query.listing_id}_2026-06-18`,
						max_stay: 365,
						min_stay: 1,
						price: 100,
						reservation_id: null,
						status: "available",
						statusNote: "",
					},
				],
				listing_id: query.listing_id,
				success: true,
			};
		},
	};
}

// Calendar v2 collapses availability into `status`; a full page mixing the three
// states exercises the active mapping (only "available" is bookable) and the
// camelCase `basePrice` / boolean cta-ctd fields the v1 shape did not have.
class FakeV2StatusClient {
	readonly calendar = {
		list: async (query: { listing_id: string | number; page: number }) => {
			if (query.page > 1) {
				return { calendar: [], listing_id: query.listing_id, success: true };
			}
			return {
				calendar: [
					{
						basePrice: 90,
						cta: false,
						ctd: false,
						currency: "EUR",
						date: "2026-06-18",
						id: `${query.listing_id}_2026-06-18`,
						min_stay: 2,
						price: 90,
						reservation_id: null,
						status: "available",
						statusNote: "",
					},
					{
						basePrice: 90,
						cta: true,
						ctd: false,
						currency: "EUR",
						date: "2026-06-19",
						id: `${query.listing_id}_2026-06-19`,
						min_stay: 2,
						price: 90,
						reservation_id: 555,
						status: "booked",
						statusNote: "reservation",
					},
					{
						basePrice: 90,
						cta: false,
						ctd: true,
						currency: "EUR",
						date: "2026-06-20",
						id: `${query.listing_id}_2026-06-20`,
						min_stay: 2,
						price: 90,
						reservation_id: null,
						status: "unavailable",
						statusNote: "manual-blockage",
					},
				],
				listing_id: query.listing_id,
				success: true,
			};
		},
	};
}

class FakeV2CurrencySymbolClient {
	readonly calendar = {
		list: async (query: { listing_id: string | number; page: number }) => {
			if (query.page > 1) {
				return { calendar: [], listing_id: query.listing_id, success: true };
			}
			return {
				calendar: [
					{
						basePrice: 90,
						cta: false,
						ctd: false,
						currency: "€",
						date: "2026-06-18",
						id: `${query.listing_id}_2026-06-18`,
						min_stay: 1,
						price: 90,
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

// Calendar v2 ignores `page`/`per_page` and returns the whole window on every
// page, never an empty one. The fetch loop must dedupe by date and stop once a
// page adds nothing new, or the upsert stacks duplicate dates.
class FakeV2RepeatingClient {
	pagesFetched = 0;
	readonly calendar = {
		list: async (query: { listing_id: string | number; page: number }) => {
			this.pagesFetched += 1;
			return {
				calendar: [
					{
						basePrice: 90,
						cta: false,
						ctd: false,
						currency: "EUR",
						date: "2026-06-18",
						id: `${query.listing_id}_2026-06-18`,
						min_stay: 1,
						price: 90,
						reservation_id: null,
						status: "available",
					},
					{
						basePrice: 95,
						cta: false,
						ctd: false,
						currency: "EUR",
						date: "2026-06-19",
						id: `${query.listing_id}_2026-06-19`,
						min_stay: 1,
						price: 95,
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
	readonly completeInputs: CompleteSyncStateInput[] = [];
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
	async completeSyncState(input: CompleteSyncStateInput): Promise<void> {
		this.completeInputs.push(input);
		this.state.status = "complete";
	}
	async failSyncState(): Promise<void> {
		this.state.status = "failed";
	}
}
