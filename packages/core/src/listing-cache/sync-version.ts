import { stableHash } from "./hash";

/**
 * Manual full-resync lever for the listing cache. The version is folded into
 * the content hashes the listing sync compares against (`sourceHash` and the
 * per-section hashes), so a stored row hashed under an older version can never
 * match the current projection.
 *
 * Bump this to force the next listing sync to treat every listing as changed
 * and reprocess it end to end (re-normalize, rebuild the search index and amenity
 * mapping, and re-run AI content processing) without a data backfill. Reverting
 * to a previous value reuses the rows already written under it.
 *
 * Pricing and review syncs page-and-upsert without content hashes, so the
 * version is not folded into any row they write. Instead it is recorded on their
 * `provider_sync_state` row when a cycle completes; bumping this value makes
 * their next claim start a fresh cycle immediately (bypassing the scheduled
 * interval) so they re-upsert everything under the new version.
 */
export const LISTING_SYNC_VERSION = 8;

/** Hash `value` bound to the current {@link LISTING_SYNC_VERSION}. */
export function versionedHash(value: unknown): string {
	return stableHash({ v: LISTING_SYNC_VERSION, value });
}
