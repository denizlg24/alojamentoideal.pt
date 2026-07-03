"use client";

import { useEffect, useState } from "react";
import {
	CART_CHANGED_EVENT,
	readCartRouteKey,
} from "@/lib/checkout/cart-store";
import { CheckoutController } from "./checkout-controller";
import { CheckoutFallback } from "./checkout-fallback";

export function CheckoutCartController() {
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

	return cartKey === null ? (
		<CheckoutFallback />
	) : (
		<CheckoutController key={cartKey} seed={null} />
	);
}
