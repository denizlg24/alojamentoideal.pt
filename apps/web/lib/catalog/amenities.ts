import { CatalogRepository, type CatalogScope } from "@workspace/core/catalog";
import {
	type AmenityIconName,
	HOSTIFY_AMENITY_CATALOG,
	pickAmenityIcon,
} from "@workspace/core/listing-cache";
import { getDb } from "@workspace/db";
import { cacheLife, cacheTag } from "next/cache";
import { CATALOG_LISTINGS_TAG } from "./cache";

/**
 * Amenity filter option for the homes UI: the filterable `key`, how many
 * listings offer it, and presentation (icon + label) resolved from the static
 * Hostify amenity catalog. Keys absent from the catalog fall back to the
 * keyword icon heuristic and use the raw key as their label.
 */
export interface HomesAmenityFacet {
	count: number;
	icon: AmenityIconName;
	key: string;
	label: string;
}

/**
 * Available amenity filters derived from the live catalog. Cached and
 * revalidated alongside the catalog list via the shared tag. Amenity keys match
 * the list API's filterable `amenities` values.
 */
export async function getCatalogAmenityFacets(
	scope: CatalogScope,
	limit = 24,
): Promise<HomesAmenityFacet[]> {
	"use cache";
	cacheLife("max");
	cacheTag(CATALOG_LISTINGS_TAG);

	const repository = new CatalogRepository(getDb());
	const facets = await repository.amenityFacets(scope, limit);

	return facets.map((facet) => {
		const entry = HOSTIFY_AMENITY_CATALOG[facet.key];
		return {
			count: facet.count,
			icon: entry?.icon ?? pickAmenityIcon(facet.key),
			key: facet.key,
			label: entry?.label ?? facet.key,
		};
	});
}
