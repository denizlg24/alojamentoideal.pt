import type { Metadata } from "next";
import { Suspense } from "react";
import { OrderAccessDenied } from "@/components/order/order-access-denied";
import { OrderAccessRedeemer } from "@/components/order/order-access-redeemer";
import { OrderHubShell } from "@/components/order/order-hub-shell";
import { OrderHubSkeleton } from "@/components/order/order-hub-skeleton";
import { OrderOverview } from "@/components/order/order-overview";
import { loadOrderForRequest } from "@/lib/order/load";
import { redeemOrderAccess } from "./actions";

export const metadata: Metadata = { title: "Your booking" };

interface OrderPageProps {
	params: Promise<{ reference: string }>;
	searchParams: Promise<{ token?: string | string[] }>;
}

function firstParam(value: string | string[] | undefined): string | null {
	if (Array.isArray(value)) {
		return value[0] ?? null;
	}
	return value ?? null;
}

async function OrderOverviewRoute({ params, searchParams }: OrderPageProps) {
	const { reference } = await params;
	const token = firstParam((await searchParams).token);

	// A fresh magic link arrives at the bare hub URL; redeem it (sets the member
	// cookie + redirects to the clean URL) before any access check.
	if (token) {
		return (
			<OrderAccessRedeemer
				action={redeemOrderAccess}
				reference={reference}
				token={token}
			/>
		);
	}

	const loaded = await loadOrderForRequest(reference);
	if (!loaded) {
		return <OrderAccessDenied />;
	}

	return (
		<OrderHubShell detail={loaded.detail}>
			<OrderOverview detail={loaded.detail} />
		</OrderHubShell>
	);
}

export default function OrderPage(props: OrderPageProps) {
	return (
		<Suspense fallback={<OrderHubSkeleton />}>
			<OrderOverviewRoute {...props} />
		</Suspense>
	);
}
