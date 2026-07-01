import type { CatalogListingDetailDto } from "@workspace/core/catalog";
import type { Metadata } from "next";
import { Suspense } from "react";
import { OrderAccessDenied } from "@/components/order/order-access-denied";
import { OrderHubShell } from "@/components/order/order-hub-shell";
import { OrderHubSkeleton } from "@/components/order/order-hub-skeleton";
import { OrderStayDetails } from "@/components/order/order-stay-details";
import { getCachedCatalogDetail } from "@/lib/catalog/cache";
import { getListingCatalogScope } from "@/lib/catalog/listing-route";
import { loadOrderForRequest } from "@/lib/order/load";

export const metadata: Metadata = { title: "Stay · Your booking" };

interface OrderStayPageProps {
	params: Promise<{ reference: string }>;
}

async function OrderStayRoute({ params }: OrderStayPageProps) {
	const { reference } = await params;
	const loaded = await loadOrderForRequest(reference);
	if (!loaded) {
		return <OrderAccessDenied />;
	}

	const scope = getListingCatalogScope();
	const seen = new Set<string>();
	const externalIds = loaded.detail.items
		.map((item) => item.listingExternalId)
		.filter((id): id is string => id !== null)
		.filter((id) => {
			if (seen.has(id)) {
				return false;
			}
			seen.add(id);
			return true;
		});

	const stays = (
		await Promise.all(
			externalIds.map((id) => getCachedCatalogDetail(id, scope, "en")),
		)
	).filter((listing): listing is CatalogListingDetailDto => listing !== null);

	return (
		<OrderHubShell detail={loaded.detail}>
			<OrderStayDetails stays={stays} />
		</OrderHubShell>
	);
}

export default function OrderStayPage(props: OrderStayPageProps) {
	return (
		<Suspense fallback={<OrderHubSkeleton />}>
			<OrderStayRoute {...props} />
		</Suspense>
	);
}
