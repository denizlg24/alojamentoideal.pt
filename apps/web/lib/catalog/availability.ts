import {
	AccommodationPricingRepository,
	addDaysIso,
	type EarliestStay,
	findEarliestStay,
	type ListingNight,
} from "@workspace/core/accommodations";
import type { CatalogScope } from "@workspace/core/catalog";
import { getDb } from "@workspace/db";

const WINDOW_DAYS = 365;
const QUOTE_VERIFICATION_CONCURRENCY = 4;

export interface MinimumStayCandidate {
	checkIn: string;
	checkOut: string;
	nights: number;
}

export type VerifyBookableStay = (
	stay: MinimumStayCandidate,
) => Promise<boolean>;

export interface BookingAvailability {
	/**
	 * Active (bookable) nights in the synced window, or `null` when the listing
	 * has no synced calendar at all. `null` means "do not restrict the picker"
	 * and let the live quote be the source of truth at selection time.
	 */
	availableDates: string[] | null;
	/**
	 * Dates closed to arrival: bookable to pass through, but not as a check-in.
	 * Includes provider CTA dates and active nights where no valid stay can start.
	 */
	ctaDates: string[];
	/** Dates closed to departure: cannot be selected as a checkout. */
	ctdDates: string[];
	earliestStay: EarliestStay | null;
	/** Arrival-night minimum stay overrides from the synced calendar. */
	minStayByDate: Record<string, number>;
}

function todayIso(): string {
	const now = new Date();
	return new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
	)
		.toISOString()
		.slice(0, 10);
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
	options: { verifyBookableStay?: VerifyBookableStay } = {},
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
		return emptyBookingAvailability();
	}

	const quoteBlockedArrivals = options.verifyBookableStay
		? await quoteBlockedArrivalDates(
				nights,
				minNights,
				options.verifyBookableStay,
			)
		: new Set<string>();

	return buildBookingAvailability(
		nights,
		from,
		minNights,
		quoteBlockedArrivals,
	);
}

export function buildBookingAvailability(
	nights: ListingNight[],
	from: string,
	minNights = 1,
	quoteBlockedArrivals: ReadonlySet<string> = new Set(),
): BookingAvailability {
	if (nights.length === 0) {
		return emptyBookingAvailability();
	}

	const nightsByDate = new Map(nights.map((night) => [night.date, night]));
	const availableDates: string[] = [];
	const ctaDates = new Set<string>();
	const ctdDates: string[] = [];
	const minStayByDate: Record<string, number> = {};
	for (const night of nights) {
		if (night.active) {
			availableDates.push(night.date);
		}
		if (night.cta) {
			ctaDates.add(night.date);
		}
		if (night.active && !canStartMinimumStay(night, nightsByDate, minNights)) {
			ctaDates.add(night.date);
		}
		if (quoteBlockedArrivals.has(night.date)) {
			ctaDates.add(night.date);
		}
		if (night.ctd) {
			ctdDates.push(night.date);
		}
		if (night.minStay && night.minStay > 0 && night.minStay !== minNights) {
			minStayByDate[night.date] = night.minStay;
		}
	}

	return {
		availableDates,
		ctaDates: [...ctaDates],
		ctdDates,
		earliestStay: findEarliestStay(
			applyQuoteBlockedArrivals(nights, quoteBlockedArrivals),
			from,
			minNights,
		),
		minStayByDate,
	};
}

async function quoteBlockedArrivalDates(
	nights: ListingNight[],
	minNights: number,
	verifyBookableStay: VerifyBookableStay,
): Promise<Set<string>> {
	const blocked = new Set<string>();
	const nightsByDate = new Map(nights.map((night) => [night.date, night]));
	const candidates: MinimumStayCandidate[] = [];

	for (const night of nights) {
		const candidate = minimumStayCandidate(night, nightsByDate, minNights);
		if (!candidate || !shouldVerifyCandidate(candidate, nightsByDate)) {
			continue;
		}
		candidates.push(candidate);
	}

	await verifyCandidatesWithConcurrency(
		candidates,
		verifyBookableStay,
		blocked,
	);

	return blocked;
}

async function verifyCandidatesWithConcurrency(
	candidates: MinimumStayCandidate[],
	verifyBookableStay: VerifyBookableStay,
	blocked: Set<string>,
): Promise<void> {
	let nextIndex = 0;
	const workerCount = Math.min(
		QUOTE_VERIFICATION_CONCURRENCY,
		candidates.length,
	);

	const workers = Array.from({ length: workerCount }, async () => {
		for (;;) {
			const candidate = candidates[nextIndex];
			nextIndex += 1;
			if (!candidate) {
				return;
			}

			const bookable = await verifyBookableStay(candidate);
			if (!bookable) {
				blocked.add(candidate.checkIn);
			}
		}
	});

	await Promise.all(workers);
}

function shouldVerifyCandidate(
	candidate: MinimumStayCandidate,
	nightsByDate: ReadonlyMap<string, ListingNight>,
): boolean {
	const checkoutNight = nightsByDate.get(candidate.checkOut);
	return !checkoutNight?.active || checkoutNight.ctd === true;
}

function minimumStayCandidate(
	night: ListingNight,
	nightsByDate: ReadonlyMap<string, ListingNight>,
	minNights: number,
): MinimumStayCandidate | null {
	if (!canStartMinimumStay(night, nightsByDate, minNights)) {
		return null;
	}

	const nights = minimumNightsForArrival(night, minNights);
	return {
		checkIn: night.date,
		checkOut: addDaysIso(night.date, nights),
		nights,
	};
}

function canStartMinimumStay(
	night: ListingNight,
	nightsByDate: ReadonlyMap<string, ListingNight>,
	minNights: number,
): boolean {
	if (!night.active || night.cta) {
		return false;
	}

	const nights = minimumNightsForArrival(night, minNights);
	for (let offset = 0; offset < nights; offset += 1) {
		const date = addDaysIso(night.date, offset);
		if (!nightsByDate.get(date)?.active) {
			return false;
		}
	}

	const checkout = addDaysIso(night.date, nights);
	return nightsByDate.get(checkout)?.ctd !== true;
}

function minimumNightsForArrival(
	night: ListingNight,
	minNights: number,
): number {
	return Math.max(night.minStay ?? minNights, 1);
}

function applyQuoteBlockedArrivals(
	nights: ListingNight[],
	quoteBlockedArrivals: ReadonlySet<string>,
): ListingNight[] {
	if (quoteBlockedArrivals.size === 0) {
		return nights;
	}

	return nights.map((night) =>
		quoteBlockedArrivals.has(night.date) ? { ...night, cta: true } : night,
	);
}

function emptyBookingAvailability(): BookingAvailability {
	return {
		availableDates: null,
		ctaDates: [],
		ctdDates: [],
		earliestStay: null,
		minStayByDate: {},
	};
}
