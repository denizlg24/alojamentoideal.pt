import { parseIsoDate, toIsoDate } from "./dates";

export interface ListingCalendarSelection {
	checkIn: string | null;
	checkOut: string | null;
}

/**
 * Hostify calendar dates represent occupied nights, not checkout days. A date
 * that is not an active night can still be a valid checkout endpoint when every
 * night from check-in up to the previous date is active.
 */
export function isListingCalendarDateDisabled(
	date: string,
	activeNightDates: ReadonlySet<string> | null,
	selection: ListingCalendarSelection,
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

	return !activeNightDates.has(date);
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
