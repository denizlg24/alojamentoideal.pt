"use client";

import "leaflet/dist/leaflet.css";
import "./listings-map.css";
import type { CatalogListingSummaryDto } from "@workspace/core/catalog";
import L from "leaflet";
import { useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_MAP_ZOOM, PRESET_MAP_ZOOM } from "@/lib/catalog/locations";
import {
	type ListingCardPrice,
	type ListingPriceDisplay,
	listingPriceDisplay,
} from "@/lib/catalog/pricing-display";

export interface ListingsMapProps {
	center: { latitude: number; longitude: number };
	listings: CatalogListingSummaryDto[];
	prices?: Map<string, ListingCardPrice>;
	stayQuery?: string;
	zoom?: number;
}

interface MappableListing {
	id: string;
	latitude: number;
	longitude: number;
	listing: CatalogListingSummaryDto;
}

function markerPrice(
	prices: Map<string, ListingCardPrice> | undefined,
	listingId: string,
): number | null {
	const price = prices?.get(listingId);
	if (!price) return null;
	if (price.total !== null) return Math.round(price.total);
	if (price.nightlyFrom !== null) return Math.round(price.nightlyFrom);
	return null;
}

function priceIcon(price: number | null, count: number): L.DivIcon {
	const badge =
		count > 1
			? `<span style="position:absolute;top:-7px;right:-7px;display:flex;align-items:center;justify-content:center;min-width:17px;height:17px;padding:0 4px;background:var(--card);color:var(--primary);border:1px solid var(--primary);border-radius:9999px;font-size:10px;font-weight:700;line-height:1;">${count}</span>`
			: "";
	const label = price === null ? "---" : count > 1 ? `€${price}+` : `€${price}`;
	const width = Math.max(46, label.length * 8 + 22);
	const pillHeight = 24;
	const tailHeight = 7;
	const height = pillHeight + tailHeight;

	return L.divIcon({
		className: "",
		html: `<div style="display:flex;flex-direction:column;align-items:center;width:${width}px;height:${height}px;filter:drop-shadow(0 2px 3px rgba(0,0,0,0.3));">
			<div style="position:relative;display:flex;align-items:center;justify-content:center;height:${pillHeight}px;background:var(--primary);color:var(--primary-foreground);border:1px solid color-mix(in oklch, var(--primary), black 12%);border-radius:9999px;padding:0 9px;font-size:12px;font-weight:600;line-height:1;white-space:nowrap;">${label}${badge}</div>
			<div style="width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:${tailHeight}px solid var(--primary);margin-top:-1px;"></div>
		</div>`,
		iconAnchor: [width / 2, height],
		iconSize: [width, height],
	});
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function priceHtml(priceInfo: ListingPriceDisplay): string {
	const lead = priceInfo.lead
		? `<span class="popup-price-lead">${escapeHtml(priceInfo.lead)}</span>`
		: "";
	const sub = priceInfo.sub
		? `<span class="popup-price-sub">${escapeHtml(priceInfo.sub)}</span>`
		: "";

	return `<span class="popup-price">${lead}<span class="popup-price-main">${escapeHtml(priceInfo.main)}</span>${sub}</span>`;
}

function popupListingHtml(
	listing: CatalogListingSummaryDto,
	price: ListingCardPrice | undefined,
	stayQuery: string | undefined,
): string {
	const photo = listing.coverPhoto;
	const rating = listing.reviews.average;
	const priceInfo = listingPriceDisplay(price, listing.id);
	const location =
		[listing.location.city, listing.location.country]
			.filter(Boolean)
			.join(", ") || null;
	const href = `/homes/${encodeURIComponent(listing.id)}${stayQuery ?? ""}`;
	const image = photo
		? `<div class="popup-photo"><img src="${escapeHtml(photo.thumbnailUrl ?? photo.url)}" alt="${escapeHtml(photo.caption ?? listing.title)}" /></div>`
		: `<div class="popup-photo popup-photo-empty">No photo</div>`;
	const ratingHtml =
		rating !== null
			? `<span class="popup-rating">★ <strong>${rating.toFixed(1)}</strong> <span>(${listing.reviews.count})</span></span>`
			: "";
	const locationHtml = location
		? `<span class="popup-location">${escapeHtml(location)}</span>`
		: "";

	return `<a href="${escapeHtml(href)}" class="popup-card">
		${image}
		<span class="popup-body">
			${ratingHtml}
			<span class="popup-title">${escapeHtml(listing.title)}</span>
			${locationHtml}
			${priceHtml(priceInfo)}
		</span>
	</a>`;
}

const CLUSTER_PIXEL_RADIUS = 44;

interface MarkerCluster {
	key: string;
	latitude: number;
	longitude: number;
	listings: CatalogListingSummaryDto[];
	minPrice: number | null;
}

function buildClusters({
	map,
	mappable,
	prices,
}: {
	map: L.Map;
	mappable: MappableListing[];
	prices?: Map<string, ListingCardPrice>;
}): MarkerCluster[] {
	const zoom = map.getZoom();
	const result: Array<MarkerCluster & { x: number; y: number }> = [];

	for (const entry of mappable) {
		const point = map.project([entry.latitude, entry.longitude], zoom);
		const price = markerPrice(prices, entry.id);
		const hit = result.find(
			(cluster) =>
				Math.hypot(cluster.x - point.x, cluster.y - point.y) <
				CLUSTER_PIXEL_RADIUS,
		);

		if (hit) {
			hit.listings.push(entry.listing);
			hit.minPrice =
				hit.minPrice === null
					? price
					: price === null
						? hit.minPrice
						: Math.min(hit.minPrice, price);
		} else {
			result.push({
				key: entry.id,
				latitude: entry.latitude,
				listings: [entry.listing],
				longitude: entry.longitude,
				minPrice: price,
				x: point.x,
				y: point.y,
			});
		}
	}

	return result;
}

function popupClusterElement(
	cluster: MarkerCluster,
	prices: Map<string, ListingCardPrice> | undefined,
	stayQuery: string | undefined,
): HTMLElement {
	const wrapper = document.createElement("div");
	wrapper.className = "popup-carousel";

	let index = 0;
	const count = cluster.listings.length;
	const card = document.createElement("div");
	card.className = "popup-carousel-card";

	const render = () => {
		const listing = cluster.listings[index];
		if (!listing) return;
		card.innerHTML = popupListingHtml(
			listing,
			prices?.get(listing.id),
			stayQuery,
		);
	};

	render();
	wrapper.append(card);

	if (count > 1) {
		const previous = document.createElement("button");
		previous.type = "button";
		previous.className = "popup-carousel-button popup-carousel-previous";
		previous.ariaLabel = "Previous home";
		previous.textContent = "‹";

		const next = document.createElement("button");
		next.type = "button";
		next.className = "popup-carousel-button popup-carousel-next";
		next.ariaLabel = "Next home";
		next.textContent = "›";

		const counter = document.createElement("span");
		counter.className = "popup-carousel-counter";

		const update = () => {
			counter.textContent = `${index + 1}/${count}`;
			render();
		};
		const step = (delta: number) => (event: MouseEvent) => {
			event.preventDefault();
			event.stopPropagation();
			index = (index + delta + count) % count;
			update();
		};

		previous.addEventListener("click", step(-1));
		next.addEventListener("click", step(1));
		update();
		wrapper.append(previous, next, counter);
	}

	return wrapper;
}

export function ListingsMap({
	center,
	listings,
	prices,
	stayQuery,
	zoom,
}: ListingsMapProps) {
	const [mapHandle, setMapHandle] = useState<{
		layer: L.LayerGroup;
		map: L.Map;
	} | null>(null);
	const [mounted, setMounted] = useState(false);
	const containerRef = useRef<HTMLDivElement | null>(null);
	const mapHandleRef = useRef<{
		layer: L.LayerGroup;
		map: L.Map;
	} | null>(null);

	useEffect(() => {
		setMounted(true);
	}, []);

	const mappable = useMemo<MappableListing[]>(
		() =>
			listings.flatMap((listing) => {
				const { latitude, longitude } = listing.location;
				if (latitude === null || longitude === null) return [];
				return [{ id: listing.id, latitude, longitude, listing }];
			}),
		[listings],
	);

	useEffect(() => {
		const container = containerRef.current;
		if (!mounted || !container) return;

		const existing = mapHandleRef.current;
		if (existing) {
			existing.map.setView(
				[center.latitude, center.longitude],
				zoom ?? DEFAULT_MAP_ZOOM,
			);
			existing.map.invalidateSize();
			setMapHandle(existing);
			return;
		}

		const map = L.map(container, {
			center: [center.latitude, center.longitude],
			scrollWheelZoom: true,
			zoom: zoom ?? DEFAULT_MAP_ZOOM,
		});
		const layer = L.layerGroup().addTo(map);

		L.tileLayer(
			"https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
		).addTo(map);

		const handle = { layer, map };
		mapHandleRef.current = handle;
		setMapHandle(handle);
	}, [center.latitude, center.longitude, mounted, zoom]);

	useEffect(() => {
		if (!mapHandle) return;
		const { layer, map } = mapHandle;

		const renderMarkers = () => {
			if (!map.getPane("markerPane")) return;
			layer.clearLayers();
			for (const cluster of buildClusters({ map, mappable, prices })) {
				L.marker([cluster.latitude, cluster.longitude], {
					icon: priceIcon(cluster.minPrice, cluster.listings.length),
				})
					.bindPopup(popupClusterElement(cluster, prices, stayQuery), {
						className: "listing-popup",
						closeButton: false,
						maxWidth: 240,
						minWidth: 200,
					})
					.addTo(layer);
			}
		};

		map.invalidateSize();
		const points = mappable.map(
			(entry) => [entry.latitude, entry.longitude] as [number, number],
		);
		const [first] = points;
		if (first) {
			if (points.length === 1) {
				map.setView(first, PRESET_MAP_ZOOM);
			} else {
				map.fitBounds(points, { padding: [48, 48] });
			}
		}

		renderMarkers();
		map.on("zoomend", renderMarkers);
		return () => {
			map.off("zoomend", renderMarkers);
		};
	}, [mapHandle, mappable, prices, stayQuery]);

	if (!mounted) return null;

	return <div ref={containerRef} className="h-full w-full" />;
}
