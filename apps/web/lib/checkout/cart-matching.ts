import {
	findOverlappingStay,
	type StayDateRange,
} from "@workspace/core/commerce/stay-overlap";

interface CartStayItem {
	checkIn?: string;
	checkOut?: string;
	listingId?: string;
	status: string;
	type?: string;
}

interface CartStayCollection {
	items: CartStayItem[];
	status: string;
}

function isActiveStayItem(
	item: CartStayItem,
): item is CartStayItem & StayDateRange {
	return (
		item.status === "active" &&
		item.type !== "activity" &&
		typeof item.checkIn === "string" &&
		typeof item.checkOut === "string" &&
		typeof item.listingId === "string"
	);
}

export function cartHasOverlappingStay(
	cart: CartStayCollection | null,
	stay: StayDateRange,
): boolean {
	if (cart?.status !== "draft") {
		return false;
	}

	return (
		findOverlappingStay(cart.items.filter(isActiveStayItem), stay) !== null
	);
}
