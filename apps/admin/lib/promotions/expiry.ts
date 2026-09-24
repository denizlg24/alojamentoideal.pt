export const PROMOTION_TIME_ZONE = "Europe/Lisbon";

function offsetMinutes(instant: Date, timeZone: string): number {
	const parts = new Intl.DateTimeFormat("en-US", {
		day: "2-digit",
		hour: "2-digit",
		hourCycle: "h23",
		minute: "2-digit",
		month: "2-digit",
		second: "2-digit",
		timeZone,
		year: "numeric",
	}).formatToParts(instant);
	const part = (type: Intl.DateTimeFormatPartTypes) =>
		Number(parts.find((entry) => entry.type === type)?.value);
	const wallClockAsUtc = Date.UTC(
		part("year"),
		part("month") - 1,
		part("day"),
		part("hour"),
		part("minute"),
		part("second"),
	);
	return Math.round((wallClockAsUtc - instant.getTime()) / 60_000);
}

/**
 * Last second of a calendar day (`YYYY-MM-DD`) in `timeZone`, so a code marked
 * "valid through" a date keeps working until local midnight.
 */
export function endOfDayIn(date: string, timeZone: string): Date {
	const naive = new Date(`${date}T23:59:59.000Z`);
	return new Date(naive.getTime() - offsetMinutes(naive, timeZone) * 60_000);
}
