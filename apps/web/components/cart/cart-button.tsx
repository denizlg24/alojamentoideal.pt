"use client";

import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import { ShoppingCart } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
	CART_CHANGED_EVENT,
	type CartChangedDetail,
	loadStoredCart,
	readCachedItemCount,
	readStoredCartId,
} from "@/lib/checkout/cart-store";

/**
 * Header cart entry point. Paints the cached item count immediately, refreshes
 * it from the server once per mount (only when a cart id is stored), and stays
 * live through the cart-changed event (same tab) and the storage event (other
 * tabs).
 */
export function CartButton({ opaque }: { opaque: boolean }) {
	const [count, setCount] = useState(0);

	useEffect(() => {
		setCount(readCachedItemCount());

		const onCartChanged = (event: Event) => {
			const detail = (event as CustomEvent<CartChangedDetail>).detail;
			setCount(detail?.itemCount ?? 0);
		};
		const onStorage = () => setCount(readCachedItemCount());

		window.addEventListener(CART_CHANGED_EVENT, onCartChanged);
		window.addEventListener("storage", onStorage);

		if (readStoredCartId()) {
			// Revalidates the badge; loadStoredCart broadcasts the fresh count.
			void loadStoredCart();
		}

		return () => {
			window.removeEventListener(CART_CHANGED_EVENT, onCartChanged);
			window.removeEventListener("storage", onStorage);
		};
	}, []);

	return (
		<Button
			asChild
			variant="ghost"
			size="icon"
			className={cn(
				"relative rounded-full",
				opaque
					? "text-foreground/80 hover:text-foreground"
					: "text-white/90 hover:bg-white/15 hover:text-white",
			)}
		>
			<Link
				aria-label={`Cart, ${count} ${count === 1 ? "item" : "items"}`}
				href="/cart"
			>
				<ShoppingCart className="size-5" />
				{count > 0 && (
					<span className="-top-0.5 -right-0.5 absolute flex size-4 items-center justify-center rounded-full bg-primary font-semibold text-[10px] text-primary-foreground leading-none">
						{count > 9 ? "9+" : count}
					</span>
				)}
			</Link>
		</Button>
	);
}
