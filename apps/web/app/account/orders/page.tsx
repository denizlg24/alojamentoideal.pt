import {
	listOrdersForUser,
	type UserOrderSummary,
} from "@workspace/core/commerce";
import { getDb } from "@workspace/db";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Skeleton } from "@workspace/ui/components/skeleton";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SiteFooter } from "@/components/home/site-footer";
import { SiteHeader } from "@/components/home/site-header";
import { getCurrentUser } from "@/lib/auth/session";
import { formatMinor, formatStayRange } from "@/lib/checkout/format";
import { buildPrivatePageMetadata } from "@/lib/site/metadata";

export const metadata: Metadata = buildPrivatePageMetadata({
	title: "Your orders",
	description: "Current and past bookings with Alojamento Ideal.",
});

/** Local `YYYY-MM-DD` for "has this stay/activity finished" comparisons. */
function todayIso(): string {
	return new Date().toISOString().slice(0, 10);
}

/**
 * An order is "past" once it is cancelled or every dated item has ended.
 * Orders without dated items stay current while pending/confirmed so an
 * in-flight booking never disappears into history.
 */
function isPastOrder(order: UserOrderSummary, today: string): boolean {
	if (order.status === "cancelled") {
		return true;
	}
	const endDates = order.items
		.map((item) => item.checkOut ?? item.activityDate)
		.filter((value): value is string => value !== null);
	if (endDates.length === 0) {
		return false;
	}
	return endDates.every((endDate) => endDate < today);
}

function statusBadge(status: string): {
	label: string;
	variant: "default" | "destructive" | "outline" | "secondary";
} {
	switch (status) {
		case "confirmed":
			return { label: "Confirmed", variant: "default" };
		case "pending":
			return { label: "Pending", variant: "secondary" };
		case "cancelled":
			return { label: "Cancelled", variant: "outline" };
		default:
			return { label: status, variant: "secondary" };
	}
}

function itemDateLabel(item: UserOrderSummary["items"][number]): string | null {
	if (item.checkIn && item.checkOut) {
		return formatStayRange(item.checkIn, item.checkOut);
	}
	if (item.activityDate) {
		return new Intl.DateTimeFormat("en", {
			day: "numeric",
			month: "short",
			year: "numeric",
		}).format(new Date(`${item.activityDate}T00:00:00`));
	}
	return null;
}

function OrderCard({ order }: { order: UserOrderSummary }) {
	const badge = statusBadge(order.status);
	const placedOn = new Intl.DateTimeFormat("en", {
		day: "numeric",
		month: "short",
		year: "numeric",
	}).format(order.createdAt);

	return (
		<Link
			href={`/order/${order.publicReference}`}
			className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm transition-shadow hover:shadow-md"
		>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="flex items-center gap-2">
					<span className="font-medium text-sm">{order.publicReference}</span>
					<Badge variant={badge.variant}>{badge.label}</Badge>
				</div>
				<span className="text-muted-foreground text-sm">
					Placed {placedOn} · {formatMinor(order.totalMinor, order.currency)}
				</span>
			</div>
			<div className="flex flex-col gap-2">
				{order.items.map((item) => {
					const dateLabel = itemDateLabel(item);
					return (
						<div key={item.id} className="flex items-center gap-3">
							<div className="relative size-12 shrink-0 overflow-hidden rounded-md bg-muted">
								{item.imageUrl && (
									<Image
										alt={item.title}
										className="object-cover"
										fill
										sizes="3rem"
										src={item.imageUrl}
									/>
								)}
							</div>
							<div className="min-w-0">
								<p className="line-clamp-1 font-medium text-sm">{item.title}</p>
								<p className="text-muted-foreground text-xs">
									{item.type === "accommodation" ? "Stay" : "Activity"}
									{dateLabel ? ` · ${dateLabel}` : ""}
								</p>
							</div>
						</div>
					);
				})}
			</div>
		</Link>
	);
}

function OrdersGroup({
	emptyLabel,
	orders,
	title,
}: {
	emptyLabel?: string;
	orders: UserOrderSummary[];
	title: string;
}) {
	if (orders.length === 0 && !emptyLabel) {
		return null;
	}
	return (
		<section className="flex flex-col gap-3">
			<h2 className="font-semibold text-lg">{title}</h2>
			{orders.length === 0 ? (
				<p className="rounded-xl border border-dashed px-4 py-8 text-center text-muted-foreground text-sm">
					{emptyLabel}
				</p>
			) : (
				orders.map((order) => (
					<OrderCard key={order.publicReference} order={order} />
				))
			)}
		</section>
	);
}

async function OrdersData() {
	const user = await getCurrentUser();
	if (!user) {
		redirect("/login?next=/account/orders");
	}

	const orders = await listOrdersForUser(getDb(), user.id);

	if (orders.length === 0) {
		return (
			<div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-16 text-center">
				<p className="font-medium">No orders yet</p>
				<p className="text-muted-foreground text-sm">
					When you book a stay or activity, it will show up here.
				</p>
				<Button asChild className="mt-2 rounded-full" size="sm">
					<Link href="/homes">Browse homes</Link>
				</Button>
			</div>
		);
	}

	const today = todayIso();
	const current = orders.filter((order) => !isPastOrder(order, today));
	const past = orders.filter((order) => isPastOrder(order, today));

	return (
		<div className="flex flex-col gap-8">
			<OrdersGroup
				emptyLabel="No upcoming stays or activities right now."
				orders={current}
				title="Current and upcoming"
			/>
			<OrdersGroup orders={past} title="Past orders" />
		</div>
	);
}

export default function OrdersPage() {
	return (
		<div className="flex min-h-screen flex-col">
			<SiteHeader solid />
			<main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-24 pb-16 sm:px-6">
				<header className="pb-6">
					<h1 className="font-heading font-semibold text-3xl">Orders</h1>
					<p className="mt-1 text-muted-foreground text-sm">
						Your current bookings and order history.
					</p>
				</header>
				<Suspense
					fallback={
						<div className="flex flex-col gap-3">
							<Skeleton className="h-28 w-full rounded-xl" />
							<Skeleton className="h-28 w-full rounded-xl" />
						</div>
					}
				>
					<OrdersData />
				</Suspense>
			</main>
			<SiteFooter />
		</div>
	);
}
