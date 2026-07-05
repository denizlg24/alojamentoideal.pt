import { describe, expect, test } from "bun:test";
import type { ListingCacheConfig } from "./config";
import { HostifyListingCacheSync } from "./hostify-sync";
import { buildListingCacheProjection } from "./normalizer";
import type {
	AdvanceSyncStateInput,
	ClaimedSyncState,
	ClaimSyncStateInput,
	CompleteSyncStateInput,
	FailSyncStateInput,
	IncrementSyncRunStatsInput,
	ListingCacheRepository,
	ListingState,
	RefreshListingCoordinatesInput,
	SyncRunInput,
	UpsertListingInput,
} from "./repository";
import { LISTING_SYNC_VERSION } from "./sync-version";

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
	syncVersion: LISTING_SYNC_VERSION,
};

describe("buildListingCacheProjection amenities", () => {
	test("maps amenities from the detail sibling array, not the listing object", () => {
		const projection = buildListingCacheProjection({
			amenities: [
				{ id: 46, target_id: 4, name: "Air conditioning" },
				{ id: 9, target_id: 88, name: "Fire extinguisher" },
			],
			description: null,
			details: null,
			fees: [],
			guestGuide: { success: true },
			// The listing object itself carries no amenities (Hostify returns them
			// only as an include_related_objects sibling), so this must not be the
			// extraction source.
			listing: { id: "1", name: "Test", sync_amenities: null },
			photos: [],
			rooms: [],
			status: "Clean",
			translations: [],
		});

		const amenities = projection.processedFallback.amenities;
		expect(amenities.map((amenity) => amenity.id)).toEqual([
			"air-conditioning",
			"9",
		]);
		expect(amenities.map((amenity) => amenity.sourceLabel)).toEqual([
			"Air conditioning",
			"Fire extinguisher",
		]);
		expect(amenities[0]?.icon.name).toBe("FaSnowflake");
		expect(amenities[0]?.labels.en).toBe("Air conditioning");
	});

	test("collapses equivalent Hostify amenities into public groups", () => {
		const projection = buildListingCacheProjection({
			amenities: [
				{ id: 2, name: "Wireless Internet" },
				{ id: 128, name: "FREE internet access" },
				{ id: 171, name: "Free Wireless Internet" },
				{ id: 230, name: "High speed Internet access" },
				{ id: 5, name: "Washer" },
				{ id: 161, name: "washing machine" },
				{ id: 719, name: "Washer on property" },
				{ id: 3, name: "Kitchen" },
				{ id: 114, name: "Full kitchen" },
				{ id: 1, name: "TV" },
			],
			description: null,
			details: null,
			fees: [],
			guestGuide: { success: true },
			listing: { id: "1", name: "Test" },
			photos: [],
			rooms: [],
			status: "Clean",
			translations: [],
		});

		const amenities = projection.processedFallback.amenities;
		expect(amenities.map((amenity) => amenity.id)).toEqual([
			"wifi",
			"washer",
			"kitchen",
			"1",
		]);
		expect(amenities.map((amenity) => amenity.labels.en)).toEqual([
			"Wifi",
			"Washer",
			"Kitchen",
			"TV",
		]);
		expect(amenities[0]?.icon.name).toBe("FaWifi");
		expect(projection.normalized.amenities).toHaveLength(10);
	});
});

describe("buildListingCacheProjection visibility", () => {
	test("prefers Hostify is_listed over active", () => {
		const projection = buildListingCacheProjection({
			amenities: [],
			description: null,
			details: null,
			fees: [],
			guestGuide: { success: true },
			listing: { active: true, id: "1", is_listed: 0, name: "Test" },
			photos: [],
			rooms: [],
			status: "Clean",
			translations: [],
		});

		expect(projection.active).toBe(false);
	});

	test("does not treat housekeeping status as listing visibility", () => {
		const projection = buildListingCacheProjection({
			amenities: [],
			description: null,
			details: null,
			fees: [],
			guestGuide: { success: true },
			listing: { active: true, id: "1", name: "Test" },
			photos: [],
			rooms: [],
			status: "Clean",
			translations: [],
		});

		expect(projection.active).toBe(true);
	});
});

describe("buildListingCacheProjection description", () => {
	test("uses summary as the lead and provider translations as localized fallbacks", () => {
		const projection = buildListingCacheProjection({
			amenities: [],
			description: {
				description: "Long description with extra notes",
				summary: "Clean summary",
			},
			details: null,
			fees: [],
			guestGuide: { success: true },
			listing: { id: "1", name: "Test" },
			photos: [],
			rooms: [],
			status: "Clean",
			translations: [
				{ language: "pt", summary: "Resumo limpo" },
				{ description: "Descripcion limpia", language: "es" },
			],
		});

		expect(projection.description).toBe("Clean summary");
		expect(projection.processedFallback.description).toEqual({
			en: "Clean summary",
			es: "Descripcion limpia",
			pt: "Resumo limpo",
		});
	});

	test("uses the first translated summary when the raw description is empty", () => {
		const projection = buildListingCacheProjection({
			amenities: [],
			description: null,
			details: null,
			fees: [],
			guestGuide: null,
			listing: { id: "1", name: "Test" },
			photos: [],
			rooms: [],
			status: "Clean",
			translations: [{ language: "pt", summary: "Resumo disponível" }],
		});

		expect(projection.description).toBe("Resumo disponível");
		expect(projection.processedFallback.description.en).toBe(
			"Resumo disponível",
		);
	});

	test("drops punctuation-only description sections and stale translated copies", () => {
		const projection = buildListingCacheProjection({
			amenities: [],
			description: {
				notes: ".",
				summary: "Clean summary",
			},
			details: null,
			fees: [],
			guestGuide: null,
			listing: { id: "1", name: "Test" },
			photos: [],
			rooms: [],
			status: "Clean",
			translations: [
				{
					language: "es",
					notes: "Texto antiguo que ya no existe en la fuente.",
				},
			],
		});

		expect(projection.normalized.descriptionSections?.notes).toBe("");
		expect(projection.processedFallback.descriptionSections.notes).toEqual({
			en: "",
			es: "",
			pt: "",
		});
		expect(projection.processedFallback.guide.en).toBe("");
	});
});

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

	test("stamps the current sync version on the state when a cycle completes", async () => {
		const repository = new FakeListingCacheRepository();
		const client = new FakeHostifyClient({
			1: [listing("1")],
		});
		const sync = createSync({ client, repository });

		const completed = await sync.pollListings("poll");

		expect(completed.status).toBe("completed");
		expect(repository.state.versionHash).toBe(LISTING_SYNC_VERSION);
	});

	test("rewrites unchanged raw content when the sync version changes", async () => {
		const hostifyListing = listing("1");
		const oldProjection = buildListingCacheProjection(
			{
				amenities: [],
				description: null,
				details: null,
				fees: [],
				guestGuide: null,
				listing: hostifyListing,
				photos: [],
				rooms: null,
				status: "Clean",
				translations: [],
			},
			{ syncVersion: LISTING_SYNC_VERSION - 1 },
		);
		const repository = new FakeListingCacheRepository();
		repository.listingStates.set("1", {
			active: true,
			latitude: null,
			longitude: null,
			processedSourceHash: null,
			processingStatus: "skipped",
			sourceHash: oldProjection.sourceHash,
		});
		const client = new FakeHostifyClient({
			1: [hostifyListing],
		});
		const sync = createSync({ client, repository });

		const result = await sync.pollListings("poll");

		expect(result.status).toBe("completed");
		expect(repository.upserts.map((upsert) => upsert.externalId)).toEqual([
			"1",
		]);
		expect(repository.coordinateRefreshes).toHaveLength(0);
	});

	test("reruns immediately when the stored version is stale despite a future next run", async () => {
		const repository = new FakeListingCacheRepository();
		const client = new FakeHostifyClient({
			1: [listing("1")],
		});
		const sync = createSync({ client, repository });

		await sync.pollListings("poll");
		// Simulate a sync-version bump landing after the row last completed: the
		// stored version no longer matches the code's current version.
		repository.state.versionHash = LISTING_SYNC_VERSION - 1;

		const reran = await sync.pollListings("poll");

		expect(reran.status).toBe("completed");
		expect(reran.page).toBe(1);
		expect(repository.upserts.map((upsert) => upsert.externalId)).toEqual([
			"1",
			"1",
		]);
		expect(repository.state.versionHash).toBe(LISTING_SYNC_VERSION);
	});

	test("advances page by page after a version bump instead of restarting page 1", async () => {
		const repository = new FakeListingCacheRepository();
		const client = new FakeHostifyClient({
			1: [listing("1"), listing("2")],
			2: [listing("3")],
		});
		const sync = createSync({ client, repository });

		// A completed cycle under the previous version, then a bump lands.
		repository.state.status = "complete";
		repository.state.nextRunAt = new Date("2030-01-01T00:00:00.000Z");
		repository.state.versionHash = LISTING_SYNC_VERSION - 1;

		const first = await sync.pollListings("poll");
		const second = await sync.pollListings("poll");

		expect(first.status).toBe("advanced");
		expect(first.page).toBe(1);
		expect(second.status).toBe("completed");
		expect(second.page).toBe(2);
		expect(client.listQueries).toEqual([
			{ page: 1, per_page: 2 },
			{ page: 2, per_page: 2 },
		]);
		expect(repository.upserts.map((upsert) => upsert.externalId)).toEqual([
			"1",
			"2",
			"3",
		]);
		expect(repository.state.versionHash).toBe(LISTING_SYNC_VERSION);
	});

	test("refreshes missing coordinates when source content is unchanged", async () => {
		const hostifyListing = listing("1", {
			latitude: 41.1579,
			longitude: -8.6291,
		});
		const projection = buildListingCacheProjection({
			amenities: [],
			description: null,
			details: null,
			fees: [],
			guestGuide: null,
			listing: hostifyListing,
			photos: [],
			rooms: null,
			status: "Clean",
			translations: [],
		});
		const repository = new FakeListingCacheRepository();
		repository.listingStates.set("1", {
			active: true,
			latitude: null,
			longitude: null,
			processedSourceHash: null,
			processingStatus: "skipped",
			sourceHash: projection.sourceHash,
		});
		const client = new FakeHostifyClient({
			1: [hostifyListing],
		});
		const sync = createSync({ client, repository });

		const result = await sync.pollListings("poll");

		expect(result.status).toBe("completed");
		expect(result.data?.changedExternalIds).toEqual(["1"]);
		expect(result.data?.listingsUpdated).toBe(1);
		expect(repository.upserts).toHaveLength(0);
		expect(repository.coordinateRefreshes).toHaveLength(1);
		expect(repository.coordinateRefreshes[0]?.latitude).toBe(41.1579);
		expect(repository.coordinateRefreshes[0]?.longitude).toBe(-8.6291);
	});

	test("refreshes active state when listed visibility changes but source hash is unchanged", async () => {
		const hostifyListing = listing("1", { is_listed: 0 });
		const projection = buildListingCacheProjection({
			amenities: [],
			description: null,
			details: null,
			fees: [],
			guestGuide: null,
			listing: hostifyListing,
			photos: [],
			rooms: null,
			status: "Clean",
			translations: [],
		});
		const repository = new FakeListingCacheRepository();
		repository.listingStates.set("1", {
			active: true,
			latitude: null,
			longitude: null,
			processedSourceHash: null,
			processingStatus: "skipped",
			sourceHash: projection.sourceHash,
		});
		const client = new FakeHostifyClient({
			1: [hostifyListing],
		});
		const sync = createSync({ client, repository });

		const result = await sync.pollListings("poll");

		expect(result.status).toBe("completed");
		expect(result.data?.changedExternalIds).toEqual(["1"]);
		expect(result.data?.listingsUpdated).toBe(1);
		expect(repository.upserts).toHaveLength(0);
		expect(repository.coordinateRefreshes).toHaveLength(1);
		expect(repository.coordinateRefreshes[0]?.active).toBe(false);
		expect(repository.listingStates.get("1")?.active).toBe(false);
	});

	test("captures related detail siblings in the raw listing cache", async () => {
		const repository = new FakeListingCacheRepository();
		const client = new FakeHostifyClient({
			1: [
				listing("1", {
					checkin_end: "00:00:00",
					checkin_start: "15:00:00",
					checkout: "11:00:00",
				}),
			],
		});
		client.detailSiblings.set("1", {
			amenities: [{ id: 46, name: "Air conditioning" }],
			description: {
				description: "Detail sibling description",
				directions: "Take the metro to Trindade.",
				house_rules: "No parties. No smoking.",
				notes: "No parking on site.",
				summary: "Detail sibling summary",
			},
			details: {
				floor: 2,
				wireless_password: "should not be persisted",
				wireless_ssid: "Guest Wifi",
			},
			guest_guide: {
				area_guide: {
					description: "Explore the best nearby cafes",
					name: "Area guide",
					places: [
						{
							description: "Great coffee and pastries",
							name: "Corner Cafe",
						},
					],
				},
			},
			rooms: [
				{
					beds: [{ count: 1, type: "Queen bed" }],
					name: "Bedroom",
					person_capacity: 2,
					room_type: "Bedroom",
					shared: 0,
				},
			],
		});
		const sync = createSync({ client, repository });

		const result = await sync.pollListings("poll");

		expect(result.status).toBe("completed");
		expect(client.getQueries).toEqual([
			{ guest_guide: 1, id: "1", include_related_objects: 1 },
		]);
		const upsert = repository.upserts[0];
		expect(upsert?.normalized.description).toBe("Detail sibling summary");
		expect(upsert?.processed.description.en).toBe("Detail sibling summary");
		expect(upsert?.raw.description).toEqual({
			description: "Detail sibling description",
			directions: "Take the metro to Trindade.",
			house_rules: "No parties. No smoking.",
			notes: "No parking on site.",
			summary: "Detail sibling summary",
		});
		expect(upsert?.raw.details).toEqual({
			floor: 2,
			wireless_ssid: "Guest Wifi",
		});
		expect(upsert?.raw.guestGuide).toEqual({
			area_guide: {
				description: "Explore the best nearby cafes",
				name: "Area guide",
				places: [
					{
						description: "Great coffee and pastries",
						name: "Corner Cafe",
					},
				],
			},
		});
		// The guest-facing guide is assembled from the check-in schedule and the
		// optional `description` fields, not the unpopulated `guest_guide` endpoint.
		const guide = upsert?.processed.guide.en ?? "";
		expect(guide).toContain("Check-in and check-out");
		expect(guide).toContain("Check-in: from 15:00");
		expect(guide).toContain("Check-out: until 11:00");
		expect(guide).toContain("Getting there\nTake the metro to Trindade.");
		expect(guide).toContain("House rules\nNo parties. No smoking.");
		expect(guide).toContain("Good to know\nNo parking on site.");
		expect(guide).not.toContain("area_guide");
		expect(upsert?.raw.rooms).toEqual([
			{
				beds: [{ count: 1, type: "Queen bed" }],
				name: "Bedroom",
				person_capacity: 2,
				room_type: "Bedroom",
				shared: 0,
			},
		]);
		expect(upsert?.processed.amenities[0]?.sourceLabel).toBe(
			"Air conditioning",
		);
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

function listing(
	id: string,
	overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
	return {
		active: true,
		city: "Lisbon",
		description: `Description ${id}`,
		id,
		name: `Listing ${id}`,
		...overrides,
	};
}

class FakeHostifyClient {
	readonly detailSiblings = new Map<string, Record<string, unknown>>();
	readonly getQueries: Array<{
		guest_guide?: 0 | 1;
		id: string;
		include_related_objects?: 0 | 1;
	}> = [];
	readonly listQueries: Array<{ page: number; per_page: number }> = [];
	readonly listings = {
		get: async (
			id: string,
			query: { guest_guide?: 0 | 1; include_related_objects?: 0 | 1 } = {},
		) => {
			this.getQueries.push({ id, ...query });
			return {
				listing: this.findListing(id),
				...this.detailSiblings.get(id),
			};
		},
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

	private findListing(id: string): unknown {
		for (const listings of Object.values(this.pages)) {
			const match = listings.find((value) => {
				if (typeof value !== "object" || value === null) return false;
				return String((value as Record<string, unknown>).id) === id;
			});
			if (match) return match;
		}

		return listing(id);
	}
}

class FakeListingCacheRepository {
	readonly coordinateRefreshes: RefreshListingCoordinatesInput[] = [];
	readonly listingStates = new Map<string, ListingState>();
	readonly runs: SyncRunInput[] = [];
	readonly upserts: UpsertListingInput[] = [];
	state: {
		activeRunId: string | null;
		leaseExpiresAt: Date | null;
		nextPage: number;
		nextRunAt: Date | null;
		status: "complete" | "failed" | "idle" | "running";
		versionHash: number;
	} = {
		activeRunId: null,
		leaseExpiresAt: null,
		nextPage: 1,
		nextRunAt: null,
		status: "idle",
		versionHash: 0,
	};

	async claimSyncState(
		input: ClaimSyncStateInput,
	): Promise<ClaimedSyncState | null> {
		const versionChanged = this.state.versionHash !== input.versionHash;
		if (
			this.state.nextRunAt &&
			this.state.nextRunAt > input.now &&
			!versionChanged
		) {
			return null;
		}
		if (this.state.leaseExpiresAt && this.state.leaseExpiresAt > input.now) {
			return null;
		}

		const startedNewCycle = this.state.status !== "running" || versionChanged;
		if (startedNewCycle) {
			this.state.activeRunId = input.newRunId;
			this.state.nextPage = 1;
		}

		this.state.leaseExpiresAt = input.leaseExpiresAt;
		this.state.status = "running";
		this.state.versionHash = input.versionHash;

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

	async findListingState(
		_provider: string,
		_accountId: string,
		externalId: string,
	): Promise<ListingState | null> {
		return this.listingStates.get(externalId) ?? null;
	}

	async refreshListingCoordinates(
		input: RefreshListingCoordinatesInput,
	): Promise<boolean> {
		this.coordinateRefreshes.push(input);
		const state = this.listingStates.get(input.externalId);
		if (state) {
			this.listingStates.set(input.externalId, {
				...state,
				active: input.active,
				latitude: input.latitude,
				longitude: input.longitude,
			});
		}
		return true;
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
		this.state.versionHash = input.versionHash;
	}

	async failSyncState(input: FailSyncStateInput): Promise<void> {
		this.state.leaseExpiresAt = null;
		this.state.nextRunAt = input.nextRunAt;
		this.state.status = "failed";
	}
}
