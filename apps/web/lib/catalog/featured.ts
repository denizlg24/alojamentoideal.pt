import type {
	CatalogListingSummaryDto,
	CatalogListQuery,
} from "@workspace/core/catalog";
import { getListingCacheConfig } from "@workspace/core/listing-cache";
import { getCachedCatalogList } from "./cache";
import { HOSTIFY_PROVIDER } from "./constants";

/**
 * Size of the cached pool the homepage draws from. Until admins can curate a
 * featured set from the dashboard, the homepage shows a slice of the most
 * recent active listings.
 */
const FEATURED_POOL_SIZE = 12;

/**
 * Returns active listings to highlight on the homepage. The underlying list
 * read is cached and revalidated by the Hostify sync cron, so this stays a
 * static read despite reading the account scope from the environment.
 *
 * TODO(dashboard): replace the recent-listings pool with the admin-selected
 * featured set once curation lands.
 */
export async function getFeaturedListings(
	count: number,
): Promise<CatalogListingSummaryDto[]> {
	const clampedCount = Math.min(count, FEATURED_POOL_SIZE);

	const config = getListingCacheConfig();
	const query: CatalogListQuery = {
		amenities: [],
		bathroomsMin: null,
		bedroomsMin: null,
		city: null,
		country: null,
		includeInactive: false,
		limit: FEATURED_POOL_SIZE,
		locale: "en",
		minGuests: null,
		offset: 0,
		propertyType: null,
		radius: null,
		sort: "recent",
		text: null,
	};

	const result = await getCachedCatalogList(query, {
		accountId: config.hostifyAccountId,
		provider: HOSTIFY_PROVIDER,
	});

	return result.items.slice(0, clampedCount);
}
