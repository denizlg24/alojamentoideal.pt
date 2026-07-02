import { findOverlappingStay } from "@workspace/core/commerce/stay-overlap";

export interface StayDateSelection {
	checkIn: string;
	checkOut: string;
	listingId: string;
}

interface CartStayItem extends StayDateSelection {
	status: string;
}

interface CartStayCollection {
	items: CartStayItem[];
	status: string;
}

export function cartHasOverlappingStay(
	cart: CartStayCollection | null,
	stay: StayDateSelection,
): boolean {
	if (cart?.status !== "draft") {
		return false;
	}

	return (
		findOverlappingStay(
			cart.items.filter((item) => item.status === "active"),
			stay,
		) !== null
	);
}
