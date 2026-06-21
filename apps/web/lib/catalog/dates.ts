/**
 * Client-safe date helpers shared by the listing date picker. The calendar works
 * in local `Date`s while availability is keyed by plain `YYYY-MM-DD`, so these
 * convert between the two without crossing a timezone boundary.
 */

export function toIsoDate(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

export function parseIsoDate(iso: string): Date {
	const [year, month, day] = iso.split("-").map(Number);
	return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

export function nightsBetween(checkIn: string, checkOut: string): number {
	const start = parseIsoDate(checkIn).getTime();
	const end = parseIsoDate(checkOut).getTime();
	return Math.round((end - start) / 86_400_000);
}
