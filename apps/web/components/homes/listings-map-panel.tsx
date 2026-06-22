"use client";

import dynamic from "next/dynamic";
import type { ListingsMapProps } from "./listings-map";
import { MapPlaceholder } from "./map-placeholder";

/**
 * Leaflet touches `window` at module load, so the map must never render on the
 * server. This client wrapper defers loading it to the browser and shows an
 * inert map placeholder while the chunk downloads.
 */
const ListingsMap = dynamic(
	() => import("./listings-map").then((module) => module.ListingsMap),
	{
		ssr: false,
		loading: () => <MapPlaceholder />,
	},
);

export function ListingsMapPanel(props: ListingsMapProps) {
	return <ListingsMap {...props} />;
}
