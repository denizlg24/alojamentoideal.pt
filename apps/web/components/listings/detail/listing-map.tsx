"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useRef, useState } from "react";
import { CARTO_TILE_ATTRIBUTION, getCartoTileUrl } from "@/lib/catalog/maps";

/**
 * Single-marker Leaflet map for the listing's "Where you'll be" section. Touches
 * `window` at module load, so it is only ever loaded via the ssr-disabled
 * dynamic wrapper in `listing-location.tsx`.
 */
export function ListingMap({
	latitude,
	longitude,
}: {
	latitude: number;
	longitude: number;
}) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const [mounted, setMounted] = useState(false);

	useEffect(() => {
		setMounted(true);
	}, []);

	useEffect(() => {
		const container = containerRef.current;
		if (!mounted || !container) return;

		const map = L.map(container, {
			center: [latitude, longitude],
			scrollWheelZoom: false,
			zoom: 14,
		});

		L.tileLayer(getCartoTileUrl(), {
			attribution: CARTO_TILE_ATTRIBUTION,
		}).addTo(map);

		L.marker([latitude, longitude], {
			icon: L.divIcon({
				className: "",
				html: '<div style="width:22px;height:22px;border-radius:9999px;background:var(--primary);border:3px solid var(--primary-foreground);box-shadow:0 1px 4px rgba(0,0,0,0.4);"></div>',
				iconAnchor: [11, 11],
				iconSize: [22, 22],
			}),
		}).addTo(map);

		map.invalidateSize();

		return () => {
			map.remove();
		};
	}, [latitude, longitude, mounted]);

	if (!mounted) return null;

	return <div ref={containerRef} className="h-full w-full" />;
}
