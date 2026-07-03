import {
	findOverlappingStay,
	type StayDateRange,
} from "@workspace/core/commerce/stay-overlap";

interface CartStayItem extends StayDateRange {
	status: string;
}

interface CartStayCollection {
	items: CartStayItem[];
	status: string;
}

export function cartHasOverlappingStay(
	cart: CartStayCollection | null,
	stay: StayDateRange,
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
