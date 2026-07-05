import * as Sentry from "@sentry/nextjs";
import { CommerceError } from "@workspace/core/commerce";
import { logger } from "@workspace/core/observability";
import type { Metadata } from "next";
import { Suspense } from "react";
import { OrderAccessDenied } from "@/components/order/order-access-denied";
import {
	type GuestBookingView,
	OrderGuests,
} from "@/components/order/order-guests";
import { OrderHubShell } from "@/components/order/order-hub-shell";
import { OrderHubSkeleton } from "@/components/order/order-hub-skeleton";
import { accountProfileRepository } from "@/lib/api/account";
import { getCurrentUser } from "@/lib/auth/session";
import { loadOrderForRequest } from "@/lib/order/load";
import { buildPrivatePageMetadata } from "@/lib/site/metadata";

export const metadata: Metadata = buildPrivatePageMetadata({
	title: "Guests · Your booking",
	description:
		"Add and verify guest registration details for your Alojamento Ideal booking.",
});

interface OrderGuestsPageProps {
	params: Promise<{ reference: string }>;
}

async function OrderGuestsRoute({ params }: OrderGuestsPageProps) {
	const { reference } = await params;
	const loaded = await loadOrderForRequest(reference);
	if (!loaded) {
		return <OrderAccessDenied />;
	}

	const service = loaded.service;
	const user = await getCurrentUser();
	const canReuseAccountIdentity = user
		? (await accountProfileRepository().getProfile(user.id)).identity.status ===
			"verified"
		: false;
	const bookableItems = loaded.detail.items.filter(
		(item): item is typeof item & { providerBooking: { id: string } } =>
			item.providerBooking !== null,
	);

	const bookings: GuestBookingView[] = await Promise.all(
		bookableItems.map(async (item) => {
			try {
				const list = await service.readBookingGuests(
					loaded.access,
					item.providerBooking.id,
				);
				return {
					bookingId: item.providerBooking.id,
					guests: list.guests,
					title: item.title,
					unavailable: false,
				};
			} catch (error) {
				const unavailable = {
					bookingId: item.providerBooking.id,
					guests: [],
					title: item.title,
					unavailable: true,
				};
				// An invited member is scoped to the slot they were invited to fill, so
				// a booking with no slot for them is an expected access boundary, not a
				// failure; it simply reads as unavailable.
				if (
					error instanceof CommerceError &&
					(error.code === "order_full" || error.code === "order_access_denied")
				) {
					return unavailable;
				}
				// A genuine read failure should still render the section rather than a
				// 500, but it does get logged.
				logger.error(
					`Failed to read guests for booking ${item.providerBooking.id} in order ${reference}.`,
					{
						orderReference: reference,
						providerBookingId: item.providerBooking.id,
					},
				);
				Sentry.captureException(
					new Error(
						`Failed to read guests for booking ${item.providerBooking.id} in order ${reference}.`,
					),
					{
						extra: {
							orderReference: reference,
							providerBookingId: item.providerBooking.id,
						},
						level: "error",
					},
				);
				return unavailable;
			}
		}),
	);

	return (
		<OrderHubShell detail={loaded.detail}>
			<OrderGuests
				bookings={bookings}
				canReuseAccountIdentity={canReuseAccountIdentity}
				reference={reference}
				role={loaded.detail.role}
			/>
		</OrderHubShell>
	);
}

export default function OrderGuestsPage(props: OrderGuestsPageProps) {
	return (
		<Suspense fallback={<OrderHubSkeleton />}>
			<OrderGuestsRoute {...props} />
		</Suspense>
	);
}
