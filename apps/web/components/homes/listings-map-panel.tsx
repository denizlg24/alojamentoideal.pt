"use client";

import { Skeleton } from "@workspace/ui/components/skeleton";
import dynamic from "next/dynamic";
import type { ListingsMapProps } from "./listings-map";

/**
 * Leaflet touches `window` at module load, so the map must never render on the
 * server. This client wrapper defers loading it to the browser and shows a
 * skeleton while the chunk downloads.
 */
const ListingsMap = dynamic(
	() => import("./listings-map").then((module) => module.ListingsMap),
	{
		ssr: false,
		loading: () => <Skeleton className="h-full w-full rounded-none" />,
	},
);

export function ListingsMapPanel(props: ListingsMapProps) {
	return <ListingsMap {...props} />;
}
