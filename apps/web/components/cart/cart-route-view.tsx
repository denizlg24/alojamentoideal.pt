"use client";

import { useEffect, useState } from "react";
import {
	CART_CHANGED_EVENT,
	readCartRouteKey,
} from "@/lib/checkout/cart-store";
import { CartLoading, CartView } from "./cart-view";

export function CartRouteView() {
	const [cartKey, setCartKey] = useState<string | null>(null);

	useEffect(() => {
		const refresh = () => setCartKey(readCartRouteKey());

		refresh();
		window.addEventListener(CART_CHANGED_EVENT, refresh);
		window.addEventListener("storage", refresh);

		return () => {
			window.removeEventListener(CART_CHANGED_EVENT, refresh);
			window.removeEventListener("storage", refresh);
		};
	}, []);

	return cartKey === null ? <CartLoading /> : <CartView key={cartKey} />;
}
