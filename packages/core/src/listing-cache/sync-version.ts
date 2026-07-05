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
 * to a previous value reuses the rows already written under it. The default is
 * kept in code, and `LISTING_SYNC_VERSION` can override it at runtime so
 * production can trigger a fresh sync from deployment environment config.
 *
 * Pricing and review syncs page-and-upsert without content hashes, so the
 * version is not folded into any row they write. Instead it is recorded on their
 * `provider_sync_state` row when a cycle completes; bumping this value makes
 * their next claim start a fresh cycle immediately (bypassing the scheduled
 * interval) so they re-upsert everything under the new version.
 */
export const DEFAULT_LISTING_SYNC_VERSION = 9;
export const MAX_LISTING_SYNC_VERSION = 2_147_483_647;

interface ListingSyncVersionEnvironment {
	LISTING_SYNC_VERSION?: string;
}

export function getListingSyncVersion(
	environment: ListingSyncVersionEnvironment = {
		LISTING_SYNC_VERSION: process.env.LISTING_SYNC_VERSION,
	},
): number {
	const value = environment.LISTING_SYNC_VERSION;
	if (value === undefined || value.trim() === "") {
		return DEFAULT_LISTING_SYNC_VERSION;
	}

	const parsed = Number(value);
	if (
		!Number.isInteger(parsed) ||
		parsed < 0 ||
		parsed > MAX_LISTING_SYNC_VERSION
	) {
		throw new Error(
			"LISTING_SYNC_VERSION must be an integer between 0 and 2147483647",
		);
	}

	return parsed;
}

export const LISTING_SYNC_VERSION = getListingSyncVersion();

/** Hash `value` bound to the current {@link LISTING_SYNC_VERSION}. */
export function versionedHash(
	value: unknown,
	syncVersion = LISTING_SYNC_VERSION,
): string {
	return stableHash({ v: syncVersion, value });
}
