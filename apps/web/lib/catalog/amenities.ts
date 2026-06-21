import {
	type CatalogAmenityFacet,
	CatalogRepository,
	type CatalogScope,
} from "@workspace/core/catalog";
import { getDb } from "@workspace/db";
import { cacheLife, cacheTag } from "next/cache";
import { CATALOG_LISTINGS_TAG } from "./cache";

export type { CatalogAmenityFacet };

/**
 * Available amenity filters derived from the live catalog. Cached and
 * revalidated alongside the catalog list via the shared tag. Amenity keys match
 * the list API's filterable `amenities` values.
 */
export async function getCatalogAmenityFacets(
	scope: CatalogScope,
	limit = 24,
): Promise<CatalogAmenityFacet[]> {
	"use cache";
	cacheLife("max");
	cacheTag(CATALOG_LISTINGS_TAG);

	const repository = new CatalogRepository(getDb());
	return repository.amenityFacets(scope, limit);
}
