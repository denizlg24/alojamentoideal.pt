import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { OrderAccessDenied } from "@/components/order/order-access-denied";
import { OrderActivityDetails } from "@/components/order/order-activity-details";
import { OrderHubShell } from "@/components/order/order-hub-shell";
import { OrderHubSkeleton } from "@/components/order/order-hub-skeleton";
import {
	findOrderActivityItem,
	loadOrderActivityView,
} from "@/lib/order/activity";
import { loadOrderForRequest } from "@/lib/order/load";
import { buildPrivatePageMetadata } from "@/lib/site/metadata";

export const metadata: Metadata = buildPrivatePageMetadata({
	title: "Activity · Your booking",
	description:
		"Review your activity details, meeting point, tickets and booking information for your Alojamento Ideal booking.",
});

interface OrderActivityPageProps {
	params: Promise<{ itemId: string; reference: string }>;
}

async function OrderActivityRoute({ params }: OrderActivityPageProps) {
	const { itemId, reference } = await params;
	const loaded = await loadOrderForRequest(reference);
	if (!loaded) {
		return <OrderAccessDenied />;
	}

	const item = findOrderActivityItem(loaded.detail, itemId);
	if (!item) {
		notFound();
	}

	const view = await loadOrderActivityView(item);

	return (
		<OrderHubShell detail={loaded.detail}>
			<OrderActivityDetails detail={loaded.detail} view={view} />
		</OrderHubShell>
	);
}

export default function OrderActivityPage(props: OrderActivityPageProps) {
	return (
		<Suspense fallback={<OrderHubSkeleton />}>
			<OrderActivityRoute {...props} />
		</Suspense>
	);
}
