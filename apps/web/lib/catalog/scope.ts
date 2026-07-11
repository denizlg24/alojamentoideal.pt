import type { CatalogScope } from "@workspace/core/catalog";
import { getListingCacheConfig } from "@workspace/core/listing-cache";
import { HOSTIFY_PROVIDER } from "@/lib/catalog/constants";

/**
 * The site's single catalog scope (the configured Hostify account). User-side
 * features that key rows by listing (bookmarks, internal reviews) share it so
 * their rows line up with the synced catalog.
 */
export function defaultCatalogScope(): CatalogScope {
	const config = getListingCacheConfig();
	return { accountId: config.hostifyAccountId, provider: HOSTIFY_PROVIDER };
}
