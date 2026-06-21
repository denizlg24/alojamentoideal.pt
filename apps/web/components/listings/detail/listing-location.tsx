"use client";

import type { CatalogLocationDto } from "@workspace/core/catalog";
import { Skeleton } from "@workspace/ui/components/skeleton";
import dynamic from "next/dynamic";

const ListingMap = dynamic(
	() => import("./listing-map").then((module) => module.ListingMap),
	{
		loading: () => <Skeleton className="h-full w-full rounded-none" />,
		ssr: false,
	},
);

function addressLine(location: CatalogLocationDto): string | null {
	const parts = [
		location.address,
		location.postalCode,
		location.city,
		location.state,
		location.country,
	].filter((part): part is string => Boolean(part));
	return parts.length > 0 ? parts.join(", ") : null;
}

export function ListingLocation({
	location,
}: {
	location: CatalogLocationDto;
}) {
	if (location.latitude === null || location.longitude === null) {
		return null;
	}

	const line = addressLine(location);

	return (
		<section className="flex flex-col gap-4">
			<h2 className="font-heading font-semibold text-2xl">Where you'll be</h2>
			{line && <p className="text-muted-foreground text-sm">{line}</p>}
			<div className="isolate h-80 overflow-hidden rounded-2xl border">
				<ListingMap
					latitude={location.latitude}
					longitude={location.longitude}
				/>
			</div>
		</section>
	);
}
