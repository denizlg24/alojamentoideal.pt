"use client";

import { useEffect, useState } from "react";
import {
	CART_CHANGED_EVENT,
	readStoredCartId,
} from "@/lib/checkout/cart-store";
import { CartLoading, CartView } from "./cart-view";

/**
 * Keys the client `CartView` on the shared cart id alone. Content changes
 * (dates, guests, add/remove) are reconciled in place by `CartView` itself, so
 * this only remounts when the cart id actually changes (a fresh or expired
 * cart), never mid-edit.
 */
export function CartRouteView() {
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

	return ready ? <CartView key={cartId ?? "empty"} /> : <CartLoading />;
}
