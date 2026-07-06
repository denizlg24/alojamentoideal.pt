import type { BookingAvailability } from "./availability";

export interface StayRestriction {
	arrivalBlocked: boolean;
	departureBlocked: boolean;
	restrictionError: boolean;
}

export function getStayRestriction(
	checkIn: string | null,
	checkOut: string | null,
	availability: Pick<BookingAvailability, "ctaDates" | "ctdDates"> | null,
): StayRestriction {
	const arrivalBlocked = Boolean(
		checkIn && availability?.ctaDates.includes(checkIn),
	);
	const departureBlocked = Boolean(
		checkOut && availability?.ctdDates.includes(checkOut),
	);
	return {
		arrivalBlocked,
		departureBlocked,
		restrictionError: arrivalBlocked || departureBlocked,
	};
}
