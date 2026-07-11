import "server-only";

import type { OrderDetail } from "@workspace/core/commerce";
import { ListingReviewRepository } from "@workspace/core/listing-reviews";
import { getDb } from "@workspace/db";
import { defaultCatalogScope } from "@/lib/catalog/scope";

/** Review state for one reviewable stay on the order hub. */
export interface OrderReviewItemState {
	existing: {
		comments: string | null;
		rating: number | null;
		status: string;
	} | null;
	itemId: string;
	/** Reviews open once the stay has started (check-in day onward). */
	stayStarted: boolean;
	title: string;
}

/** Local `YYYY-MM-DD`; stay dates are date-only strings in property time. */
function todayIso(): string {
	return new Date().toISOString().slice(0, 10);
}

export function listingReviewRepository(): ListingReviewRepository {
	return new ListingReviewRepository(getDb());
}

/**
 * Builds the review state for each stay on the order, for the hub's
 * "share your experience" section. Only the order owner writes reviews, and
 * only for confirmed orders; other viewers get an empty list.
 */
export async function loadOrderReviewItems(
	detail: OrderDetail,
): Promise<OrderReviewItemState[]> {
	if (detail.role !== "owner" || detail.bookingStatus !== "confirmed") {
		return [];
	}

	const stays = detail.items.filter(
		(item) => item.type === "accommodation" && item.listingExternalId !== null,
	);
	if (stays.length === 0) {
		return [];
	}

	const repository = listingReviewRepository();
	const scope = defaultCatalogScope();
	const today = todayIso();

	return Promise.all(
		stays.map(async (item) => {
			const existing = await repository.findByReservation(
				scope.provider,
				scope.accountId,
				"internal",
				item.id,
			);
			return {
				existing: existing
					? {
							comments: existing.comments,
							rating: existing.rating,
							status: existing.status,
						}
					: null,
				itemId: item.id,
				stayStarted: item.checkIn !== null && item.checkIn <= today,
				title: item.title,
			};
		}),
	);
}
