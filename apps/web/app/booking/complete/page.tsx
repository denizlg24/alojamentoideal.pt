import type { Metadata } from "next";
import { Suspense } from "react";
import { BookingCompleteView } from "@/components/checkout/booking-complete-view";
import { CheckoutHeader } from "@/components/checkout/checkout-header";

export const metadata: Metadata = {
	title: "Booking status",
};

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
