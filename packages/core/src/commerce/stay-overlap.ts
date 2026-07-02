export interface StayDateRange {
	checkIn: string;
	checkOut: string;
	listingId: string;
}

export function stayDateRangesOverlap(
	first: StayDateRange,
	second: StayDateRange,
): boolean {
	return (
		first.listingId === second.listingId &&
		first.checkIn < second.checkOut &&
		second.checkIn < first.checkOut
	);
}

export function findOverlappingStay<T extends StayDateRange>(
	stays: T[],
	target: StayDateRange,
): T | null {
	return stays.find((stay) => stayDateRangesOverlap(stay, target)) ?? null;
}
