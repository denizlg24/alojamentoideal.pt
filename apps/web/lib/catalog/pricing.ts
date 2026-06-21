import type { NightlyPriceSummary } from "@workspace/core/accommodations";
import {
	AccommodationPricingRepository,
	getAccommodationsConfig,
} from "@workspace/core/accommodations";
import type { CatalogListQuery, CatalogScope } from "@workspace/core/catalog";
import { CatalogRepository } from "@workspace/core/catalog";
import { getDb } from "@workspace/db";
import { cacheLife, cacheTag } from "next/cache";
import { CATALOG_LISTINGS_TAG } from "./cache";

/**
 * Tag covering every cached advisory-pricing read. The nightly price sync
 * revalidates it so the homepage and homes list pick up fresh "from" rates
 * without each request hitting the database.
 */
export const ADVISORY_PRICING_TAG = "catalog:advisory-pricing";

/**
 * Advisory "from" nightly price per listing, derived from the synced Hostify
 * calendar. Cached and revalidated by the price sync cron, mirroring the
 * catalog list read, so the homepage stays a static read.
 */
export async function getCachedAdvisoryPrices(
	scope: CatalogScope,
	listingIds: string[],
): Promise<NightlyPriceSummary[]> {
	"use cache";
	cacheLife("max");
	cacheTag(ADVISORY_PRICING_TAG);

	if (listingIds.length === 0) {
		return [];
	}

	const config = getAccommodationsConfig();
	const repository = new AccommodationPricingRepository(getDb());
	const prices = await repository.fromPricesForListings(scope, {
		currency: config.currency,
		listingIds,
	});

	return [...prices.values()];
}

/**
 * Advisory nightly price range (min/max) across listings matching the query,
 * ignoring the query's own price bounds. Feeds the homes price slider. Cached
 * and revalidated alongside the catalog and price syncs.
 */
export async function getCachedPriceBounds(
	query: CatalogListQuery,
	scope: CatalogScope,
): Promise<{ max: number; min: number } | null> {
	"use cache";
	cacheLife("max");
	cacheTag(ADVISORY_PRICING_TAG);
	cacheTag(CATALOG_LISTINGS_TAG);

	const repository = new CatalogRepository(getDb());
	return repository.priceBounds(query, scope);
}
