"use client";

import { useEffect, useState } from "react";
import {
	CART_CHANGED_EVENT,
	readStoredCartId,
} from "@/lib/checkout/cart-store";
import { CheckoutController } from "./checkout-controller";
import { CheckoutFallback } from "./checkout-fallback";

/**
 * Keys the checkout controller on the shared cart id alone. In-place edits
 * (single-stay inline editing, discount changes) reconcile within the
 * controller, so this only remounts when the cart id itself changes.
 */
export function CheckoutCartController() {
	const [cartId, setCartId] = useState<string | null>(null);
	const [ready, setReady] = useState(false);

	useEffect(() => {
		const refresh = () => {
			setCartId(readStoredCartId());
			setReady(true);
		};

		refresh();
		window.addEventListener(CART_CHANGED_EVENT, refresh);
		window.addEventListener("storage", refresh);

		return () => {
			window.removeEventListener(CART_CHANGED_EVENT, refresh);
			window.removeEventListener("storage", refresh);
		};
	}, []);

	return ready ? (
		<CheckoutController key={cartId ?? "empty"} seed={null} />
	) : (
		<CheckoutFallback />
	);
}
