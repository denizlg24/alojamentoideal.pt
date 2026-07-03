import type { Metadata } from "next";
import { Suspense } from "react";
import { CheckoutCartController } from "@/components/checkout/checkout-cart-controller";
import { CheckoutFallback } from "@/components/checkout/checkout-fallback";
import { CheckoutHeader } from "@/components/checkout/checkout-header";
import { buildPrivatePageMetadata } from "@/lib/site/metadata";

export const metadata: Metadata = buildPrivatePageMetadata({
	title: "Confirm and pay",
	description:
		"Review the stays in your cart, add your details and pay securely in one checkout.",
});

/**
 * Cart-driven checkout: purchases every stay in the shared cart in one
 * payment. The "Reserve" entry point (`/homes/[id]/book`) renders the same
 * controller with a seeded stay.
 */
export default function CheckoutPage() {
	return (
		<div className="flex min-h-screen flex-col bg-muted/20">
			<CheckoutHeader backHref="/cart" />
			<main className="flex-1">
				<Suspense fallback={<CheckoutFallback />}>
					<CheckoutCartController />
				</Suspense>
			</main>
		</div>
	);
}
