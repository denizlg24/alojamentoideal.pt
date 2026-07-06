import type { ListingNight } from "./repository";

export interface EarliestStay {
	checkIn: string;
	checkOut: string;
	nights: number;
}

/** Adds (or subtracts) whole days to a `YYYY-MM-DD` date in UTC. */
export function addDaysIso(date: string, days: number): string {
	const value = new Date(`${date}T00:00:00.000Z`);
	value.setUTCDate(value.getUTCDate() + days);
	return value.toISOString().slice(0, 10);
}

/**
 * Picks the soonest bookable stay from the synced nightly calendar: the first
 * active arrival on or after `from` whose required `minStay` window is fully
 * active (no gaps, no blocked nights). The listing page preselects this so the
 * visitor lands on a valid range and sees a live quote without first opening the
 * calendar. Returns `null` when nothing in the window is bookable.
 */
export function findEarliestStay(
	nights: ListingNight[],
	from: string,
	fallbackMinNights = 1,
): EarliestStay | null {
	const byDate = new Map(nights.map((night) => [night.date, night]));
	const defaultMinNights = Math.max(fallbackMinNights, 1);
	const candidates = nights
		.filter((night) => night.active && night.date >= from)
		.sort((a, b) => a.date.localeCompare(b.date));

	for (const start of candidates) {
		// Closed-to-arrival: the day is open for stays passing through but cannot be
		// a check-in, so it can never be the start of the earliest stay.
		if (start.cta) {
			continue;
		}

		const minNights = Math.max(start.minStay ?? defaultMinNights, 1);
		let windowOk = true;
		for (let offset = 0; offset < minNights; offset += 1) {
			const night = byDate.get(addDaysIso(start.date, offset));
			if (!night?.active) {
				windowOk = false;
				break;
			}
		}

		if (!windowOk) {
			continue;
		}

		// Closed-to-departure: the checkout day cannot be a departure. It is the
		// night after the stay, so an unsynced day (not in the map) is unrestricted.
		const checkOut = addDaysIso(start.date, minNights);
		if (byDate.get(checkOut)?.ctd) {
			continue;
		}

		return {
			checkIn: start.date,
			checkOut,
			nights: minNights,
		};
	}

	return null;
}
