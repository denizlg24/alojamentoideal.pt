import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { OrderAccessDenied } from "@/components/order/order-access-denied";
import { OrderHubShell } from "@/components/order/order-hub-shell";
import { OrderHubSkeleton } from "@/components/order/order-hub-skeleton";
import { OrderPeople } from "@/components/order/order-people";
import { loadOrderForRequest } from "@/lib/order/load";

export const metadata: Metadata = { title: "People · Your booking" };

interface OrderPeoplePageProps {
	params: Promise<{ reference: string }>;
}

function orderCapacity(
	items: { guests: number | null; infants: number | null }[],
): number {
	return items.reduce(
		(total, item) =>
			total + Math.max((item.guests ?? 0) - (item.infants ?? 0), 0),
		0,
	);
}

async function OrderPeopleRoute({ params }: OrderPeoplePageProps) {
	const { reference } = await params;
	const loaded = await loadOrderForRequest(reference);
	if (!loaded) {
		return <OrderAccessDenied />;
	}

	// People is owner-only; a member who deep-links here goes back to their hub.
	if (loaded.detail.role !== "owner") {
		redirect(`/order/${encodeURIComponent(reference)}`);
	}

	return (
		<OrderHubShell detail={loaded.detail}>
			<OrderPeople
				capacity={orderCapacity(loaded.detail.items)}
				initialMembers={loaded.detail.members ?? []}
				reference={reference}
			/>
		</OrderHubShell>
	);
}

export default function OrderPeoplePage(props: OrderPeoplePageProps) {
	return (
		<Suspense fallback={<OrderHubSkeleton />}>
			<OrderPeopleRoute {...props} />
		</Suspense>
	);
}
