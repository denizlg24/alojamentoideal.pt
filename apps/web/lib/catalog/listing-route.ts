import { CatalogRepository, type CatalogScope } from "@workspace/core/catalog";
import { getListingCacheConfig } from "@workspace/core/listing-cache";
import { getDb } from "@workspace/db";
import { HOSTIFY_PROVIDER } from "./constants";

export function getListingCatalogScope(): CatalogScope {
	const config = getListingCacheConfig();
	return { accountId: config.hostifyAccountId, provider: HOSTIFY_PROVIDER };
}

export async function generateListingStaticParams(): Promise<{ id: string }[]> {
	try {
		const repository = new CatalogRepository(getDb());
		const ids = await repository.listExternalIds(getListingCatalogScope());
		if (ids.length === 0) {
			return [{ id: "__ci_placeholder__" }];
		}
		return ids.map((id) => ({ id }));
	} catch {
		return [{ id: "__ci_placeholder__" }];
	}
}
