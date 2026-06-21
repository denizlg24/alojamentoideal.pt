"use client";

import "leaflet/dist/leaflet.css";
import "./listings-map.css";
import type { CatalogListingSummaryDto } from "@workspace/core/catalog";
import L from "leaflet";
import { ChevronLeft, ChevronRight, Star } from "lucide-react";
import Link from "next/link";
import {
	type MouseEvent,
	useCallback,
	useEffect,
	useId,
	useMemo,
	useState,
} from "react";
import {
	MapContainer,
	Marker,
	Popup,
	TileLayer,
	useMap,
	useMapEvents,
} from "react-leaflet";
import { DEFAULT_MAP_ZOOM, PRESET_MAP_ZOOM } from "@/lib/catalog/locations";
import { placeholderNightlyPrice } from "@/lib/catalog/placeholder-price";
import {
	type ListingCardPrice,
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

/**
 * Headline figure for a marker: the stay total when a date range is selected,
 * otherwise the advisory "from" nightly rate, falling back to the deterministic
 * placeholder so a pin always shows a price.
 */
function markerPrice(
	prices: Map<string, ListingCardPrice> | undefined,
	listingId: string,
): number {
	const price = prices?.get(listingId);
	if (price) {
		if (price.total != null) {
			return Math.round(price.total);
		}
		if (price.nightlyFrom != null) {
			return Math.round(price.nightlyFrom);
		}
	}
	return placeholderNightlyPrice(listingId);
}

/**
 * Price marker styled with the app theme tokens. The pulsing dot is anchored to
 * the exact coordinate, so nearby buildings remain visually distinct as the user
 * zooms in. When several listings share the exact spot, the cheapest price is
 * shown with a small count badge.
 */
function priceIcon(price: number, count: number): L.DivIcon {
	const badge =
		count > 1
			? `<span style="position:absolute;top:-7px;right:-7px;display:flex;align-items:center;justify-content:center;min-width:17px;height:17px;padding:0 4px;background:var(--card);color:var(--primary);border:1px solid var(--primary);border-radius:9999px;font-size:10px;font-weight:700;line-height:1;">${count}</span>`
			: "";
	const label = count > 1 ? `€${price}+` : `€${price}`;
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

/** Re-frames the map to the current markers whenever the result set changes. */
function FitToMarkers({ points }: { points: [number, number][] }) {
	const map = useMap();

	useEffect(() => {
		map.invalidateSize();
		const [first] = points;
		if (!first) return;
		if (points.length === 1) {
			map.setView(first, PRESET_MAP_ZOOM);
			return;
		}
		map.fitBounds(points, { padding: [48, 48] });
	}, [map, points]);

	return null;
}

function PopupCard({
	listing,
	price,
	stayQuery,
}: {
	listing: CatalogListingSummaryDto;
	price?: ListingCardPrice;
	stayQuery?: string;
}) {
	const photo = listing.coverPhoto;
	const rating = listing.reviews.average;
	const priceInfo = listingPriceDisplay(price, listing.id);
	const location =
		[listing.location.city, listing.location.country]
			.filter(Boolean)
			.join(", ") || null;

	return (
		<Link
			href={`/homes/${listing.id}${stayQuery ?? ""}`}
			className="block w-50"
		>
			<div className="relative aspect-video w-full bg-muted">
				{photo ? (
					// biome-ignore lint/performance/noImgElement: Leaflet popups render outside Next's Image pipeline.
					<img
						src={photo.thumbnailUrl ?? photo.url}
						alt={listing.title}
						className="h-full w-full object-cover"
					/>
				) : (
					<div className="flex h-full w-full items-center justify-center text-muted-foreground text-xs">
						No photo
					</div>
				)}
			</div>
			<div className="flex flex-col gap-0.5 p-3">
				{rating !== null && (
					<span className="flex items-center gap-1 text-xs">
						<Star className="size-3 fill-amber-500 text-amber-500" />
						<span className="font-medium text-foreground">
							{rating.toFixed(1)}
						</span>
						<span className="text-muted-foreground">
							({listing.reviews.count})
						</span>
					</span>
				)}
				<span className="line-clamp-1 font-semibold text-foreground text-sm">
					{listing.title}
				</span>
				{location && (
					<span className="line-clamp-1 text-muted-foreground text-xs">
						{location}
					</span>
				)}
				<span className="mt-1 flex items-baseline gap-1">
					{priceInfo.lead && (
						<span className="text-muted-foreground text-xs">
							{priceInfo.lead}
						</span>
					)}
					<span className="font-semibold text-foreground text-sm">
						{priceInfo.main}
					</span>
					<span className="text-muted-foreground text-xs">{priceInfo.sub}</span>
				</span>
			</div>
		</Link>
	);
}

/**
 * Popup contents for a single map pin. When multiple listings share the exact
 * coordinate (e.g. apartments in the same building) it becomes a small carousel
 * so each home is reachable from the one marker.
 */
function MarkerPopup({
	listings,
	prices,
	stayQuery,
}: {
	listings: CatalogListingSummaryDto[];
	prices?: Map<string, ListingCardPrice>;
	stayQuery?: string;
}) {
	const [index, setIndex] = useState(0);
	const count = listings.length;
	const current = listings[Math.min(index, count - 1)];

	const step = (delta: number) => (event: MouseEvent) => {
		event.preventDefault();
		event.stopPropagation();
		setIndex((value) => (value + delta + count) % count);
	};

	if (!current) return null;

	return (
		<div className="relative w-50">
			<PopupCard
				listing={current}
				price={prices?.get(current.id)}
				stayQuery={stayQuery}
			/>
			{count > 1 && (
				<>
					<button
						type="button"
						aria-label="Previous home"
						onClick={step(-1)}
						className="absolute top-14 left-1.5 flex size-7 -translate-y-1/2 items-center justify-center rounded-full border bg-card/90 text-foreground shadow-sm backdrop-blur transition-colors hover:bg-card"
					>
						<ChevronLeft className="size-4" />
					</button>
					<button
						type="button"
						aria-label="Next home"
						onClick={step(1)}
						className="absolute top-14 right-1.5 flex size-7 -translate-y-1/2 items-center justify-center rounded-full border bg-card/90 text-foreground shadow-sm backdrop-blur transition-colors hover:bg-card"
					>
						<ChevronRight className="size-4" />
					</button>
					<span className="absolute top-2 right-2 rounded-full bg-black/60 px-1.5 py-0.5 font-medium text-[10px] text-white">
						{index + 1}/{count}
					</span>
				</>
			)}
		</div>
	);
}

/** Merge radius in screen pixels; markers closer than this collapse into one. */
const CLUSTER_PIXEL_RADIUS = 44;

interface MarkerCluster {
	key: string;
	latitude: number;
	longitude: number;
	listings: CatalogListingSummaryDto[];
	minPrice: number;
}

/**
 * Renders the markers, clustering listings that would overlap on screen.
 * Distance is measured in projected pixels at the current zoom, so neighbouring
 * buildings merge into one pin when zoomed out and split apart as the user
 * zooms in. Same-spot listings stay reachable through the popup carousel.
 */
function ClusteredMarkers({
	mappable,
	prices,
	stayQuery,
}: {
	mappable: MappableListing[];
	prices?: Map<string, ListingCardPrice>;
	stayQuery?: string;
}) {
	const map = useMap();
	const [zoom, setZoom] = useState(() => map.getZoom());

	useMapEvents({
		zoomend: () => setZoom(map.getZoom()),
	});

	const clusters = useMemo<MarkerCluster[]>(() => {
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
				hit.minPrice = Math.min(hit.minPrice, price);
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
	}, [mappable, prices, zoom, map]);

	return (
		<>
			{clusters.map((cluster) => (
				<Marker
					key={cluster.key}
					position={[cluster.latitude, cluster.longitude]}
					icon={priceIcon(cluster.minPrice, cluster.listings.length)}
				>
					<Popup
						className="listing-popup"
						closeButton={false}
						minWidth={200}
						maxWidth={200}
					>
						<MarkerPopup
							listings={cluster.listings}
							prices={prices}
							stayQuery={stayQuery}
						/>
					</Popup>
				</Marker>
			))}
		</>
	);
}

export function ListingsMap({
	center,
	listings,
	prices,
	stayQuery,
	zoom,
}: ListingsMapProps) {
	const [mounted, setMounted] = useState(false);
	const [mapReady, setMapReady] = useState(false);
	const instanceKey = useId();

	useEffect(() => {
		setMounted(true);
	}, []);

	const handleMapReady = useCallback(() => {
		setMapReady(true);
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

	const points = useMemo<[number, number][]>(
		() => mappable.map((entry) => [entry.latitude, entry.longitude]),
		[mappable],
	);

	if (!mounted) return null;

	return (
		<MapContainer
			key={instanceKey}
			center={[center.latitude, center.longitude]}
			zoom={zoom ?? DEFAULT_MAP_ZOOM}
			scrollWheelZoom
			className="h-full w-full"
			whenReady={handleMapReady}
		>
			{mapReady && (
				<>
					<TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" />
					<ClusteredMarkers
						mappable={mappable}
						prices={prices}
						stayQuery={stayQuery}
					/>
					<FitToMarkers points={points} />
				</>
			)}
		</MapContainer>
	);
}
