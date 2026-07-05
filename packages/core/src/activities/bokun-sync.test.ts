import { describe, expect, test } from "bun:test";
import type { BokunActivityDetail } from "../integrations/bokun";
import { sanitizeProviderPayload, stableHash } from "../listing-cache/hash";
import { BokunActivityCacheSync } from "./bokun-sync";
import type {
	ActivityCacheRepository,
	ActivityState,
	ClaimActivitySyncStateInput,
	ClaimedActivitySyncState,
	CompleteActivitySyncStateInput,
	DisableMissingActivitiesInput,
	FailActivitySyncStateInput,
	FinishActivitySyncRunInput,
	SyncRunInput,
	UpsertActivityInput,
} from "./cache-repository";
import type { ActivityCacheConfig } from "./config";
import { ACTIVITY_SYNC_VERSION } from "./sync-version";

const baseConfig: ActivityCacheConfig = {
	accountId: "acct_1",
	activityIds: ["1", "2"],
	currency: "EUR",
	lang: "en",
	staleAfterHours: 24,
	syncIntervalHours: 24,
	syncLeaseMinutes: 10,
};

describe("BokunActivityCacheSync.pollActivities", () => {
	test("syncs configured activities and disables removed cached rows", async () => {
		const repository = new FakeActivityCacheRepository();
		repository.disabledExternalIds = ["old"];
		const client = new FakeBokunClient({
			"1": activity("1", { secretToken: "do-not-store" }),
			"2": activity("2"),
		});
		const sync = createSync({ client, repository });

		const result = await sync.pollActivities("poll");

		expect(result.status).toBe("completed");
		expect(result.nextRunAt).toBe("2026-06-19T12:00:00.000Z");
		expect(result.data?.activitiesSeen).toBe(2);
		expect(result.data?.activitiesCreated).toBe(2);
		expect(result.data?.activitiesDisabled).toBe(1);
		expect(result.data?.changedExternalIds).toEqual(["1", "2", "old"]);
		expect(repository.upserts.map((upsert) => upsert.sortOrder)).toEqual([
			0, 1,
		]);
		expect(repository.disabledInputs[0]?.keepExternalIds).toEqual(["1", "2"]);
		expect(
			(repository.upserts[0]?.raw as Record<string, unknown>).secretToken,
		).toBeUndefined();
		expect(repository.state.status).toBe("complete");
		expect(repository.state.versionHash).toBe(ACTIVITY_SYNC_VERSION);
	});

	test("does not rewrite unchanged active activities", async () => {
		const raw = activity("1");
		const repository = new FakeActivityCacheRepository();
		repository.states.set("1", {
			active: true,
			sortOrder: 0,
			sourceHash: stableHash(sanitizeProviderPayload(raw)),
		});
		const client = new FakeBokunClient({ "1": raw });
		const sync = createSync({
			client,
			config: { ...baseConfig, activityIds: ["1"] },
			repository,
		});

		const result = await sync.pollActivities("poll");

		expect(result.status).toBe("completed");
		expect(result.data?.activitiesUnchanged).toBe(1);
		expect(result.data?.changedExternalIds).toEqual([]);
		expect(repository.upserts).toHaveLength(0);
	});

	test("skips polls before the next run time", async () => {
		const repository = new FakeActivityCacheRepository();
		const client = new FakeBokunClient({
			"1": activity("1"),
			"2": activity("2"),
		});
		const sync = createSync({ client, repository });

		const completed = await sync.pollActivities("poll");
		const skipped = await sync.pollActivities("poll");

		expect(completed.status).toBe("completed");
		expect(skipped.status).toBe("skipped");
		expect(client.getQueries).toEqual(["1", "2"]);
	});
});

function createSync({
	client,
	config = baseConfig,
	repository,
}: {
	client: FakeBokunClient;
	config?: ActivityCacheConfig;
	repository: FakeActivityCacheRepository;
}) {
	return new BokunActivityCacheSync({
		client: client as never,
		config,
		now: () => new Date("2026-06-18T12:00:00.000Z"),
		repository: repository as unknown as ActivityCacheRepository,
	});
}

function activity(
	id: string,
	overrides: Partial<Record<string, unknown>> = {},
): BokunActivityDetail {
	return {
		id,
		title: `Activity ${id}`,
		difficultyLevel: "EASY",
		durationHours: 2,
		googlePlace: {
			city: "Porto",
			country: "Portugal",
		},
		nextDefaultPriceMoney: {
			amount: 25,
			currency: "EUR",
		},
		...overrides,
	};
}

class FakeBokunClient {
	readonly getQueries: string[] = [];
	readonly v1 = {
		activity: {
			get: async (id: string) => {
				this.getQueries.push(id);
				const value = this.activities[id];
				if (!value) {
					throw new Error(`Missing activity ${id}`);
				}
				return value;
			},
		},
	};

	constructor(
		private readonly activities: Record<string, BokunActivityDetail>,
	) {}
}

class FakeActivityCacheRepository {
	disabledExternalIds: string[] = [];
	readonly disabledInputs: DisableMissingActivitiesInput[] = [];
	readonly finishes: FinishActivitySyncRunInput[] = [];
	readonly runs: SyncRunInput[] = [];
	readonly states = new Map<string, ActivityState>();
	readonly upserts: UpsertActivityInput[] = [];
	state: {
		activeRunId: string | null;
		leaseExpiresAt: Date | null;
		nextRunAt: Date | null;
		status: "complete" | "failed" | "idle" | "running";
		versionHash: number;
	} = {
		activeRunId: null,
		leaseExpiresAt: null,
		nextRunAt: null,
		status: "idle",
		versionHash: 0,
	};

	async claimSyncState(
		input: ClaimActivitySyncStateInput,
	): Promise<ClaimedActivitySyncState | null> {
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

		this.state.activeRunId = input.newRunId;
		this.state.leaseExpiresAt = input.leaseExpiresAt;
		this.state.status = "running";
		this.state.versionHash = input.versionHash;
		return { activeRunId: input.newRunId };
	}

	async createSyncRun(input: SyncRunInput): Promise<void> {
		this.runs.push(input);
	}

	async findActivityState(
		_scope: unknown,
		externalId: string,
	): Promise<ActivityState | null> {
		return this.states.get(externalId) ?? null;
	}

	async upsertActivity(input: UpsertActivityInput): Promise<void> {
		this.upserts.push(input);
		this.states.set(input.externalId, {
			active: input.active,
			sortOrder: input.sortOrder,
			sourceHash: input.sourceHash,
		});
	}

	async disableMissingActivities(
		input: DisableMissingActivitiesInput,
	): Promise<string[]> {
		this.disabledInputs.push(input);
		return this.disabledExternalIds;
	}

	async finishActivitySyncRun(
		_id: string,
		input: FinishActivitySyncRunInput,
	): Promise<void> {
		this.finishes.push(input);
	}

	async completeSyncState(
		input: CompleteActivitySyncStateInput,
	): Promise<void> {
		this.state.activeRunId = null;
		this.state.leaseExpiresAt = null;
		this.state.nextRunAt = input.nextRunAt;
		this.state.status = input.error ? "failed" : "complete";
		this.state.versionHash = input.versionHash;
	}

	async failSyncState(input: FailActivitySyncStateInput): Promise<void> {
		this.state.activeRunId = null;
		this.state.leaseExpiresAt = null;
		this.state.nextRunAt = input.nextRunAt;
		this.state.status = "failed";
	}
}
