"use client";

import { Skeleton } from "@workspace/ui/components/skeleton";
import { use } from "react";
import {
	type ListingCardPrice,
	listingPriceDisplay,
} from "@/lib/catalog/pricing-display";
import type { ListingCardLayout } from "./listing-card";

/**
 * Price block for a listing card, split out as a client component so the rate
 * can stream in via `<Suspense>` while the rest of the card renders from the
 * (cached) catalog read. `ListingCardPriceValue` renders a resolved price;
 * `ListingCardPriceAsync` unwraps a streamed price promise.
 */
function PriceParagraph({
	layout,
	listingId,
	value,
}: {
	layout: ListingCardLayout;
	listingId: string;
	value: ListingCardPrice | undefined;
}) {
	const info = listingPriceDisplay(value, listingId);

	if (layout === "row") {
		return (
			<p className="flex items-baseline gap-1 md:flex-col md:items-end md:gap-0">
				<span className="flex items-baseline gap-1 font-semibold text-xl leading-none">
					{info.lead && (
						<span className="font-normal text-muted-foreground text-xs">
							{info.lead}
						</span>
					)}
					{info.main}
				</span>
				<span className="text-muted-foreground text-xs">{info.sub}</span>
			</p>
		);
	}

	return (
		<p className="flex items-baseline gap-1 pt-0.5 text-sm">
			{info.lead && (
				<span className="text-muted-foreground text-xs">{info.lead}</span>
			)}
			<span className="font-semibold">{info.main}</span>
			<span className="text-muted-foreground text-xs">{info.sub}</span>
		</p>
	);
}

export function ListingCardPriceValue(props: {
	layout: ListingCardLayout;
	listingId: string;
	value: ListingCardPrice | undefined;
}) {
	return <PriceParagraph {...props} />;
}

export function ListingCardPriceAsync({
	layout,
	listingId,
	pricePromise,
}: {
	layout: ListingCardLayout;
	listingId: string;
	pricePromise: Promise<ListingCardPrice | undefined>;
}) {
	return (
		<PriceParagraph
			layout={layout}
			listingId={listingId}
			value={use(pricePromise)}
		/>
	);
}

export function ListingCardPriceSkeleton({
	layout,
}: {
	layout: ListingCardLayout;
}) {
	if (layout === "row") {
		return (
			<div className="flex flex-col items-end gap-1">
				<Skeleton className="h-6 w-16" />
				<Skeleton className="h-3 w-12" />
			</div>
		);
	}

	return (
		<div className="flex items-baseline gap-1 pt-0.5">
			<Skeleton className="h-4 w-20" />
		</div>
	);
}
