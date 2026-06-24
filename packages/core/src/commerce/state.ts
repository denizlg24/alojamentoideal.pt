import { CommerceError } from "./errors";
import type { CartStatus } from "./types";

export interface MutableCartState {
	expiresAt: Date;
	id: string;
	status: string;
}

export function assertMutableCart(
	cart: MutableCartState | null | undefined,
	now: Date,
): asserts cart is MutableCartState & { status: "draft" } {
	if (!cart) {
		throw new CommerceError("cart_not_found", "Cart not found.", 404);
	}

	if (cart.status === "converted") {
		throw new CommerceError(
			"cart_converted",
			"This cart has already been converted to an order.",
			409,
		);
	}

	if (cart.status === "expired" || cart.expiresAt.getTime() <= now.getTime()) {
		throw new CommerceError("cart_expired", "This cart has expired.", 410);
	}

	if (cart.status !== "draft") {
		throw new CommerceError(
			"cart_not_mutable",
			"This cart cannot be changed.",
			409,
		);
	}
}

export function toCartStatus(status: string): CartStatus {
	if (status === "draft" || status === "converted" || status === "expired") {
		return status;
	}

	throw new Error(`Unexpected cart status: ${status}`);
}
