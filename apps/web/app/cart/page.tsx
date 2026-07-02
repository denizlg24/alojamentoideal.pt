import type { Metadata } from "next";
import { CartRouteView } from "@/components/cart/cart-route-view";
import { SiteFooter } from "@/components/home/site-footer";
import { SiteHeader } from "@/components/home/site-header";
import { buildPrivatePageMetadata } from "@/lib/site/metadata";

export const metadata: Metadata = buildPrivatePageMetadata({
	title: "Your cart",
	description:
		"Review the stays in your cart and book them together in one checkout.",
});

export default function CartPage() {
	return (
		<div className="flex min-h-screen flex-col">
			<SiteHeader solid />
			<main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-24 pb-16 sm:px-6">
				<div className="flex flex-col gap-6">
					<h1 className="font-heading font-semibold text-2xl leading-tight">
						Your cart
					</h1>
					<CartRouteView />
				</div>
			</main>
			<SiteFooter />
		</div>
	);
}
