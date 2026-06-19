import type {
	CatalogListingDetailDto,
	CatalogListQuery,
	CatalogListResult,
	CatalogLocale,
	CatalogScope,
} from "@workspace/core/catalog";
import { CatalogRepository } from "@workspace/core/catalog";
import { getDb } from "@workspace/db";
import { cacheLife, cacheTag } from "next/cache";

/**
 * Tag applied to every cached list response. The catalog cron revalidates it
 * whenever a sync creates, updates, or removes any listing, because a single
 * change can reorder, refilter, or repaginate arbitrary list results (and a
 * newly-qualifying listing is not referenced by any existing cache entry).
 */
export const CATALOG_LISTINGS_TAG = "catalog:listings";

/**
 * Precise tag for a single listing's cached detail response. The cron
 * revalidates exactly the listings it changed.
 */
export function catalogListingTag(
	scope: CatalogScope,
	externalId: string,
): string {
	return `catalog:listing:${scope.provider}:${scope.accountId}:${externalId}`;
}

export async function getCachedCatalogList(
	query: CatalogListQuery,
	scope: CatalogScope,
): Promise<CatalogListResult> {
	"use cache";
	cacheLife("max");
	cacheTag(CATALOG_LISTINGS_TAG);

	const repository = new CatalogRepository(getDb());
	return repository.list(query, scope);
}

export async function getCachedCatalogDetail(
	externalId: string,
	scope: CatalogScope,
	locale: CatalogLocale,
): Promise<CatalogListingDetailDto | null> {
	"use cache";
	cacheLife("max");
	cacheTag(catalogListingTag(scope, externalId));

	const repository = new CatalogRepository(getDb());
	return repository.getByExternalId(externalId, scope, locale);
}
