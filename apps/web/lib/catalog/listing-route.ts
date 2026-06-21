import { CatalogRepository, type CatalogScope } from "@workspace/core/catalog";
import { getListingCacheConfig } from "@workspace/core/listing-cache";
import { getDb } from "@workspace/db";
import { HOSTIFY_PROVIDER } from "./constants";

export function getListingCatalogScope(): CatalogScope {
	const config = getListingCacheConfig();
	return { accountId: config.hostifyAccountId, provider: HOSTIFY_PROVIDER };
}

/**
 * Prewarms the cached shell for every active listing. Under `cacheComponents`,
 * params not listed here still render on-demand, so no `dynamicParams` flag is
 * needed.
 */
export async function generateListingStaticParams(): Promise<{ id: string }[]> {
	try {
		const repository = new CatalogRepository(getDb());
		const ids = await repository.listExternalIds(getListingCatalogScope());
		return ids.map((id) => ({ id }));
	} catch {
		// Without DB access at build time, fall back to on-demand rendering
		// rather than failing the build.
		return [];
	}
}
