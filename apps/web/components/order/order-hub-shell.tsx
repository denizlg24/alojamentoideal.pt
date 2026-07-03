import type { OrderDetail } from "@workspace/core/commerce";
import Image from "next/image";
import type { ReactNode } from "react";
import { SiteFooter } from "@/components/home/site-footer";
import { SiteHeader } from "@/components/home/site-header";
import { formatStayRangeLong } from "@/lib/checkout/format";
import { OrderSectionNav } from "./order-section-nav";
import { OrderStatusBadge } from "./order-status-badge";

function staySummary(
	item: OrderDetail["items"][number] | undefined,
): string | null {
	if (!item?.checkIn || !item.checkOut) {
		return null;
	}
	const range = formatStayRangeLong(item.checkIn, item.checkOut);
	if (item.guests && item.guests > 0) {
		return `${range} · ${item.guests} ${item.guests === 1 ? "guest" : "guests"}`;
	}
	return range;
}

/**
 * Overall date envelope for a multi-stay order: earliest check-in to latest
 * checkout. Individual stay dates live in the overview/stay sections.
 */
function multiStaySummary(items: OrderDetail["items"]): string | null {
	const checkIns = items
		.map((item) => item.checkIn)
		.filter((value): value is string => value !== null)
		.sort();
	const checkOuts = items
		.map((item) => item.checkOut)
		.filter((value): value is string => value !== null)
		.sort();
	const first = checkIns[0];
	const last = checkOuts.at(-1);
	if (!first || !last) {
		return null;
	}
	return `${items.filter((item) => !!item.listingExternalId).length} homes · ${formatStayRangeLong(first, last)}`;
}

/**
 * Chrome shared by every order-hub section: the site header/footer, the booking
 * heading (property, dates, status), and the nested-route section nav. Section
 * pages render their own content as `children`.
 */
export function OrderHubShell({
	detail,
	children,
}: {
	detail: OrderDetail;
	children: ReactNode;
}) {
	const item = detail.items[0];
	const multiStay = detail.items.length > 1;
	const title = multiStay
		? `Your ${detail.items.length} stays`
		: (item?.title ?? "Your booking");
	const summary = multiStay
		? multiStaySummary(detail.items)
		: staySummary(item);

	return (
		<div className="flex min-h-screen flex-col">
			<SiteHeader solid />
			<main className="mx-auto w-full max-w-4xl flex-1 px-4 pt-24 pb-16 sm:px-6">
				<div className="flex flex-col gap-6">
					<header className="flex items-start gap-4">
						{item?.imageUrl && (
							<Image
								alt={title}
								className="size-20 shrink-0 rounded-xl object-cover sm:size-24"
								height={96}
								src={item.imageUrl}
								width={96}
							/>
						)}
						<div className="flex flex-col gap-1">
							<h1 className="font-heading font-semibold text-2xl leading-tight">
								{title}
							</h1>
							{summary && (
								<p className="text-muted-foreground text-sm">{summary}</p>
							)}
							<div className="mt-1 flex flex-wrap items-center gap-2">
								<OrderStatusBadge state={detail.provisioningSubState} />
								<span className="text-muted-foreground text-xs">
									Ref {detail.reference}
								</span>
							</div>
						</div>
					</header>

					<OrderSectionNav
						reference={detail.reference}
						showMessages={detail.role === "owner"}
					/>

					{children}
				</div>
			</main>
			<SiteFooter />
		</div>
	);
}
