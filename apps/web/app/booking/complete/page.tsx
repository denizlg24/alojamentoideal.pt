import type { Metadata } from "next";
import { Suspense } from "react";
import { BookingCompleteView } from "@/components/checkout/booking-complete-view";
import { CheckoutHeader } from "@/components/checkout/checkout-header";
import { buildPrivatePageMetadata } from "@/lib/site/metadata";

export const metadata: Metadata = buildPrivatePageMetadata({
	title: "Booking status",
	description:
		"Check the server-verified payment and reservation status for your Alojamento Ideal booking.",
});

export default function BookingCompletePage() {
	return (
		<div className="flex min-h-screen flex-col bg-muted/20">
			<CheckoutHeader backHref="/homes" />
			<main className="flex-1">
				<Suspense fallback={null}>
					<BookingCompleteView />
				</Suspense>
			</main>
		</div>
	);
}
