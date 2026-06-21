import {
	AccommodationPricingRepository,
	addDaysIso,
	type EarliestStay,
	findEarliestStay,
} from "@workspace/core/accommodations";
import type { CatalogScope } from "@workspace/core/catalog";
import { getDb } from "@workspace/db";

const WINDOW_DAYS = 365;

export interface BookingAvailability {
	/**
	 * Active (bookable) nights in the synced window, or `null` when the listing
	 * has no synced calendar at all. `null` means "do not restrict the picker"
	 * and let the live quote be the source of truth at selection time.
	 */
	availableDates: string[] | null;
	earliestStay: EarliestStay | null;
	/** Arrival-night minimum stay, only for dates that require more than one. */
	minStayByDate: Record<string, number>;
}

function todayIso(): string {
	return new Date().toISOString().slice(0, 10);
}

/**
 * Loads the listing's nightly calendar and reduces it to the compact shape the
 * booking card needs: the set of bookable dates (to cross out the rest), the
 * per-date arrival min-stay, and the soonest valid stay to preselect.
 */
export async function getListingBookingAvailability(
	externalId: string,
	scope: CatalogScope,
	minNights = 1,
): Promise<BookingAvailability> {
	const from = todayIso();
	const to = addDaysIso(from, WINDOW_DAYS);

	const repository = new AccommodationPricingRepository(getDb());
	const nights = await repository.listNightsForListing(
		{ accountId: scope.accountId, provider: scope.provider },
		externalId,
		{ from, to },
	);

	if (nights.length === 0) {
		return { availableDates: null, earliestStay: null, minStayByDate: {} };
	}

	const availableDates: string[] = [];
	const minStayByDate: Record<string, number> = {};
	for (const night of nights) {
		if (night.active) {
			availableDates.push(night.date);
		}
		if (night.minStay && night.minStay > 1) {
			minStayByDate[night.date] = night.minStay;
		}
	}

	return {
		availableDates,
		earliestStay: findEarliestStay(nights, from, minNights),
		minStayByDate,
	};
}
