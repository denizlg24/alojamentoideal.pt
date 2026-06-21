"use client";

import { useEffect, useState } from "react";
import type { ListingsMapProps } from "./listings-map";
import { ListingsMapPanel } from "./listings-map-panel";

const DESKTOP_QUERY = "(min-width: 1024px)";

/**
 * Mounts the Leaflet map only when its slot's breakpoint is active. Rendering
 * both the mobile and desktop maps at once leaves one initializing inside a
 * `display:none` container, which makes react-leaflet attach a TileLayer to a
 * map whose panes don't exist yet ("getPane() is undefined"). Gating on a media
 * query keeps a single live map instance.
 */
export function ListingsMapSlot({
	slot,
	...props
}: ListingsMapProps & { slot: "mobile" | "desktop" }) {
	const [isDesktop, setIsDesktop] = useState<boolean | null>(null);

	useEffect(() => {
		const media = window.matchMedia(DESKTOP_QUERY);
		const update = () => setIsDesktop(media.matches);
		update();
		media.addEventListener("change", update);
		return () => media.removeEventListener("change", update);
	}, []);

	if (isDesktop === null) return null;
	if (slot === "desktop" ? !isDesktop : isDesktop) return null;

	return <ListingsMapPanel {...props} />;
}
