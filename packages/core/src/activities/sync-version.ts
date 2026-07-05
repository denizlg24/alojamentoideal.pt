/**
 * Cache-invalidation gate for the activity projection. It is written to
 * `providerSyncState.versionHash`; when a claim sees a different value it forces
 * a resync regardless of `nextRunAt`.
 *
 * Bump this whenever a change alters the shape or content of the cached
 * projection (the summary/detail mappers, the sanitized `raw` payload, or the
 * columns written by `upsertActivity`). Skipping a bump leaves already-cached
 * `activity_experience` rows unrefreshed until their source hash happens to
 * change.
 */
export const DEFAULT_ACTIVITY_SYNC_VERSION = 1;
export const MAX_ACTIVITY_SYNC_VERSION = 2_147_483_647;

interface ActivitySyncVersionEnvironment {
	ACTIVITY_SYNC_VERSION?: string;
}

export function getActivitySyncVersion(
	environment: ActivitySyncVersionEnvironment = {
		ACTIVITY_SYNC_VERSION: process.env.ACTIVITY_SYNC_VERSION,
	},
): number {
	const value = environment.ACTIVITY_SYNC_VERSION;
	if (value === undefined || value.trim() === "") {
		return DEFAULT_ACTIVITY_SYNC_VERSION;
	}

	const parsed = Number(value);
	if (
		!Number.isInteger(parsed) ||
		parsed < 0 ||
		parsed > MAX_ACTIVITY_SYNC_VERSION
	) {
		throw new Error(
			"ACTIVITY_SYNC_VERSION must be an integer between 0 and 2147483647",
		);
	}

	return parsed;
}

export const ACTIVITY_SYNC_VERSION = getActivitySyncVersion();
