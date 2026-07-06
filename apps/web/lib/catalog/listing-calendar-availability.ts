import { parseIsoDate, toIsoDate } from "./dates";

export interface ListingCalendarSelection {
	checkIn: string | null;
	checkOut: string | null;
}

/**
 * Hostify calendar dates represent occupied nights, not checkout days. A date
 * that is not an active night can still be a valid checkout endpoint when every
 * night from check-in up to the previous date is active.
 *
 * `closedToArrival` (calendar v2 `cta`) only blocks a date from being a
 * check-in; the night stays bookable to pass through or check out on, so it is
 * applied solely on the arrival branch. Closed-to-departure (`ctd`) is not
 * handled here: because the calendar runs with `excludeDisabled`, disabling a
 * ctd night would also stop a stay from spanning it, so the checkout ban is
 * enforced at selection time in the calendar component instead.
 */
export function isListingCalendarDateDisabled(
	date: string,
	activeNightDates: ReadonlySet<string> | null,
	selection: ListingCalendarSelection,
	closedToArrival: ReadonlySet<string> | null = null,
): boolean {
	if (!activeNightDates) {
		return false;
	}

	if (selection.checkIn && !selection.checkOut && date > selection.checkIn) {
		return !stayNightsAreActive(activeNightDates, selection.checkIn, date);
	}

	if (isSelectedCheckoutDate(date, activeNightDates, selection)) {
		return false;
	}

	if (activeNightDates.has(date)) {
		return closedToArrival?.has(date) ?? false;
	}

	return true;
}

export function isListingCalendarDateUnavailable(
	date: string,
	activeNightDates: ReadonlySet<string> | null,
	selection: ListingCalendarSelection,
): boolean {
	if (!activeNightDates) {
		return false;
	}

	if (isSelectedCheckoutDate(date, activeNightDates, selection)) {
		return false;
	}

	if (selection.checkIn && !selection.checkOut && date > selection.checkIn) {
		return !stayNightsAreActive(activeNightDates, selection.checkIn, date);
	}

	return !activeNightDates.has(date);
}

function isSelectedCheckoutDate(
	date: string,
	activeNightDates: ReadonlySet<string>,
	selection: ListingCalendarSelection,
): boolean {
	return Boolean(
		selection.checkIn &&
			selection.checkOut === date &&
			date > selection.checkIn &&
			stayNightsAreActive(activeNightDates, selection.checkIn, date),
	);
}

function stayNightsAreActive(
	activeNightDates: ReadonlySet<string>,
	checkIn: string,
	checkOut: string,
): boolean {
	for (
		let cursor = checkIn;
		cursor < checkOut;
		cursor = addDaysIsoLocal(cursor, 1)
	) {
		if (!activeNightDates.has(cursor)) {
			return false;
		}
	}

	return checkOut > checkIn;
}

function addDaysIsoLocal(date: string, days: number): string {
	const value = parseIsoDate(date);
	value.setDate(value.getDate() + days);
	return toIsoDate(value);
}
