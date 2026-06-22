import type { CatalogScope } from "@workspace/core/catalog";
import {
	type ListingReviewCategoryAverages,
	type ListingReviewDto,
	ListingReviewRepository,
} from "@workspace/core/listing-reviews";
import { getDb } from "@workspace/db";
import { cacheLife, cacheTag } from "next/cache";
import { catalogListingTag } from "./cache";

export interface ListingReviewsResult {
	averages: ListingReviewCategoryAverages;
	reviews: ListingReviewDto[];
}

const REVIEWS_LIMIT = 60;

/**
 * Cached read of a listing's displayable reviews plus its category-rating
 * breakdown. Shares the per-listing catalog tag so the reviews cron's
 * revalidation (which already drops that tag on any change) refreshes this too.
 */
export async function getCachedListingReviews(
	externalId: string,
	scope: CatalogScope,
): Promise<ListingReviewsResult> {
	"use cache";
	cacheLife("max");
	cacheTag(catalogListingTag(scope, externalId));

	const repository = new ListingReviewRepository(getDb());
	const [reviews, averages] = await Promise.all([
		repository.listForListing(scope.provider, scope.accountId, externalId, {
			limit: REVIEWS_LIMIT,
		}),
		repository.categoryAveragesForListing(
			scope.provider,
			scope.accountId,
			externalId,
		),
	]);

	return { averages, reviews };
}
