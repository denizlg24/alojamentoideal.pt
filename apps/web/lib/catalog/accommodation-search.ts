import type {
	AccommodationSearchResult,
	StayDates,
} from "@workspace/core/accommodations";
import {
	AccommodationPricingRepository,
	AccommodationSearchService,
	getAccommodationsConfig,
} from "@workspace/core/accommodations";
import type { CatalogListQuery, CatalogScope } from "@workspace/core/catalog";
import { CatalogRepository } from "@workspace/core/catalog";
import { getDb } from "@workspace/db";

interface LiveSearchInput {
	dates: StayDates;
	guests: number;
	query: CatalogListQuery;
	scope: CatalogScope;
}

/**
 * Runs the date-aware accommodation search in-process against our Postgres
 * mirror: availability filtering and the base-price estimate both come from the
 * synced nightly calendar, so no Hostify call sits on the homes grid. Used only
 * when the visitor picked a stay period; the dateless path stays on the cached
 * catalog read.
 */
export async function searchAccommodationsLive(
	input: LiveSearchInput,
): Promise<AccommodationSearchResult> {
	const config = getAccommodationsConfig();
	const db = getDb();

	const service = new AccommodationSearchService({
		catalog: new CatalogRepository(db),
		currency: config.currency,
		pricing: new AccommodationPricingRepository(db),
	});

	return service.search({
		candidateLimit: config.liveSearchCandidateLimit,
		dates: input.dates,
		guests: input.guests,
		query: input.query,
		scope: input.scope,
	});
}
