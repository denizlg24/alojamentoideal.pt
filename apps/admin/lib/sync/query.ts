import { getDb, providerSyncRun, providerSyncState } from "@workspace/db";
import { desc } from "drizzle-orm";

/** Summary of the most recent run for a job, counters folded to one entity. */
export interface SyncJobRun {
	created: number;
	error: string | null;
	failed: number;
	finishedAt: Date | null;
	seen: number;
	startedAt: Date;
	status: string;
	trigger: string;
	updated: number;
}

export interface SyncJobStatus {
	error: string | null;
	isRunning: boolean;
	key: string;
	label: string;
	lastCompletedAt: Date | null;
	lastStartedAt: Date | null;
	latestRun: SyncJobRun | null;
	nextRunAt: Date | null;
	provider: string;
	status: string;
	syncType: string;
}

type SyncRunRow = typeof providerSyncRun.$inferSelect;

const JOB_META: Record<
	string,
	{ entity: "activities" | "listings"; label: string; order: number }
> = {
	activity_cache: { entity: "activities", label: "Activities", order: 3 },
	listing_cache: { entity: "listings", label: "Homes listings", order: 0 },
	listing_reviews: { entity: "listings", label: "Guest reviews", order: 2 },
	nightly_pricing: {
		entity: "listings",
		label: "Nightly pricing & availability",
		order: 1,
	},
};

function jobMeta(syncType: string) {
	return (
		JOB_META[syncType] ?? {
			entity: "listings" as const,
			label: syncType,
			order: 99,
		}
	);
}

function toRun(run: SyncRunRow, entity: "activities" | "listings"): SyncJobRun {
	const counts =
		entity === "activities"
			? {
					created: run.activitiesCreated,
					failed: run.activitiesFailed,
					seen: run.activitiesSeen,
					updated: run.activitiesUpdated,
				}
			: {
					created: run.listingsCreated,
					failed: run.listingsFailed,
					seen: run.listingsSeen,
					updated: run.listingsUpdated,
				};

	return {
		...counts,
		error: run.error,
		finishedAt: run.finishedAt,
		startedAt: run.startedAt,
		status: run.status,
		trigger: run.trigger,
	};
}

/**
 * One row per sync job (provider + type): its live state from
 * `provider_sync_state` plus a digest of its most recent `provider_sync_run`.
 * Powers the settings-page sync status table. Reads directly - the volume is a
 * handful of rows, so no pagination is needed.
 */
export async function getSyncOverview(): Promise<SyncJobStatus[]> {
	const db = getDb();
	const [states, runs] = await Promise.all([
		db.select().from(providerSyncState),
		db
			.select()
			.from(providerSyncRun)
			.orderBy(desc(providerSyncRun.startedAt))
			.limit(100),
	]);

	const latestByKey = new Map<string, SyncRunRow>();
	for (const run of runs) {
		const key = `${run.provider}:${run.syncType}`;
		if (!latestByKey.has(key)) {
			latestByKey.set(key, run);
		}
	}

	return states
		.map((state) => {
			const meta = jobMeta(state.syncType);
			const run =
				latestByKey.get(`${state.provider}:${state.syncType}`) ?? null;
			return {
				error: state.error,
				isRunning: state.status === "running",
				key: `${state.provider}:${state.syncType}`,
				label: meta.label,
				lastCompletedAt: state.lastCompletedAt,
				lastStartedAt: state.lastStartedAt,
				latestRun: run ? toRun(run, meta.entity) : null,
				nextRunAt: state.nextRunAt,
				order: meta.order,
				provider: state.provider,
				status: state.status,
				syncType: state.syncType,
			};
		})
		.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))
		.map(({ order: _order, ...rest }) => rest);
}
