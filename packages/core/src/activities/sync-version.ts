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
export const ACTIVITY_SYNC_VERSION = 1;
