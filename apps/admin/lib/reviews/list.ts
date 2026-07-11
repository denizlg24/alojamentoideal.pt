import {
	ListingReviewRepository,
	type ListingReviewSource,
	type ReviewModerationRow,
} from "@workspace/core/listing-reviews";
import { accommodationListing, getDb } from "@workspace/db";
import { inArray } from "drizzle-orm";

export const REVIEW_STATUSES = ["pending", "published", "hidden"] as const;

export type ReviewStatusFilter = (typeof REVIEW_STATUSES)[number];

export function isReviewStatusFilter(
	value: string,
): value is ReviewStatusFilter {
	return (REVIEW_STATUSES as readonly string[]).includes(value);
}

export function isReviewSourceFilter(
	value: string,
): value is ListingReviewSource {
	return value === "external" || value === "internal";
}

export interface AdminReviewRow extends ReviewModerationRow {
	listingName: string | null;
}

export interface AdminReviewListResult {
	hasNext: boolean;
	rows: AdminReviewRow[];
}

export const REVIEWS_PAGE_SIZE = 25;

/**
 * Reviews for the moderation table, newest first, decorated with the synced
 * listing's display name so the operator does not have to map external ids.
 */
export async function listAdminReviews(filter: {
	page: number;
	source: ListingReviewSource | null;
	status: ReviewStatusFilter | null;
}): Promise<AdminReviewListResult> {
	const repository = new ListingReviewRepository(getDb());
	const { hasNext, rows } = await repository.listForModeration({
		limit: REVIEWS_PAGE_SIZE,
		offset: filter.page * REVIEWS_PAGE_SIZE,
		source: filter.source ?? undefined,
		status: filter.status ?? undefined,
	});

	const externalIds = [...new Set(rows.map((row) => row.listingExternalId))];
	const listings =
		externalIds.length > 0
			? await getDb()
					.select({
						externalId: accommodationListing.externalId,
						name: accommodationListing.name,
						nickname: accommodationListing.nickname,
					})
					.from(accommodationListing)
					.where(inArray(accommodationListing.externalId, externalIds))
			: [];
	const nameByExternalId = new Map(
		listings.map((listing) => [
			listing.externalId,
			listing.nickname ?? listing.name,
		]),
	);

	return {
		hasNext,
		rows: rows.map((row) => ({
			...row,
			listingName: nameByExternalId.get(row.listingExternalId) ?? null,
		})),
	};
}
