import {
	getAccommodationsConfig,
	parseAvailabilitySearchParams,
	type StayDates,
} from "@workspace/core/accommodations";
import {
	type CatalogListingSummaryDto,
	type CatalogListQuery,
	type CatalogScope,
	parseCatalogListQuery,
} from "@workspace/core/catalog";
import { getListingCacheConfig } from "@workspace/core/listing-cache";
import { Suspense } from "react";
import { SiteFooter } from "@/components/home/site-footer";
import { SiteHeader } from "@/components/home/site-header";
import { HomesFilterBar } from "@/components/homes/homes-filter-bar";
import {
	HomesPendingProvider,
	HomesPendingResults,
} from "@/components/homes/homes-pending";
import { HomesSkeleton } from "@/components/homes/homes-skeleton";
import { ListingsMapSlot } from "@/components/homes/listings-map-slot";
import { ListingsResults } from "@/components/homes/listings-results";
import { LocationRail } from "@/components/homes/location-rail";
import { searchAccommodationsLive } from "@/lib/catalog/accommodation-search";
import { getCatalogAmenityFacets } from "@/lib/catalog/amenities";
import { getCachedCatalogList } from "@/lib/catalog/cache";
import { HOSTIFY_PROVIDER } from "@/lib/catalog/constants";
import { HOMES_PAGE_SIZE } from "@/lib/catalog/homes-filters";
import {
	DEFAULT_MAP_CENTER,
	DEFAULT_MAP_ZOOM,
	findLocationPreset,
	PRESET_MAP_ZOOM,
} from "@/lib/catalog/locations";
import {
	getCachedAdvisoryPrices,
	getCachedPriceBounds,
} from "@/lib/catalog/pricing";
import {
	advisoryPriceMap,
	type ListingCardPrice,
	searchPriceMap,
} from "@/lib/catalog/pricing-display";

type SearchParams = Record<string, string | string[] | undefined>;

const COPYABLE_PARAMS = [
	"guests",
	"sort",
	"ratingMin",
	"bedroomsMin",
	"bathroomsMin",
	"priceMin",
	"priceMax",
	"amenities",
	"offset",
] as const;

function toUrlParams(searchParams: SearchParams): URLSearchParams {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(searchParams)) {
		if (typeof value === "string") params.set(key, value);
		else if (Array.isArray(value) && value[0]) params.set(key, value[0]);
	}
	return params;
}

/**
 * Resolves the user-facing homes query (preset `place`, derived `guests`, etc.)
 * into a validated catalog list query. The selected service area becomes a
 * radius search; an invalid combination falls back to a safe recent listing.
 */
function buildCatalogQuery(
	params: URLSearchParams,
	preset: ReturnType<typeof findLocationPreset>,
): CatalogListQuery {
	const apiParams = new URLSearchParams();
	for (const key of COPYABLE_PARAMS) {
		const value = params.get(key);
		if (value) apiParams.set(key, value);
	}
	if (preset) {
		apiParams.set("lat", String(preset.latitude));
		apiParams.set("lng", String(preset.longitude));
		apiParams.set("radiusKm", String(preset.radiusKm));
	}
	apiParams.set("limit", String(HOMES_PAGE_SIZE));

	let parsed = parseCatalogListQuery(apiParams);
	if (!parsed.success) {
		apiParams.delete("sort");
		parsed = parseCatalogListQuery(apiParams);
	}

	if (parsed.success) return parsed.data;

	return {
		amenities: [],
		bathroomsMin: null,
		bedroomsMin: null,
		city: null,
		country: null,
		includeInactive: false,
		limit: HOMES_PAGE_SIZE,
		locale: "en",
		minGuests: null,
		offset: 0,
		priceMax: null,
		priceMin: null,
		propertyType: null,
		radius: null,
		ratingMin: null,
		sort: "recent",
		text: null,
	};
}

/**
 * Booking-link query for a selected stay: the dates and guest breakdown that
 * the listing detail page reads to prefill its reservation. Returned by the
 * homes page so "Book now" links carry the chosen period.
 */
function buildStayQuery(
	params: URLSearchParams,
	stay: { dates: StayDates; guests: number },
): string {
	const next = new URLSearchParams();
	next.set("checkIn", stay.dates.checkIn);
	next.set("checkOut", stay.dates.checkOut);
	next.set("guests", String(stay.guests));
	for (const key of ["adults", "children"] as const) {
		const value = params.get(key);
		if (value) next.set(key, value);
	}
	return `?${next.toString()}`;
}

interface HomesListings {
	items: CatalogListingSummaryDto[];
	limit: number;
	offset: number;
	priceBounds: { max: number; min: number } | null;
	prices: Map<string, ListingCardPrice>;
	total: number;
}

/**
 * Loads the homes list. With a valid stay period it runs the live date-aware
 * search (availability-filtered, quoted); otherwise it reads the cached catalog
 * and decorates it with advisory "from" prices.
 */
async function loadHomesListings(
	query: CatalogListQuery,
	scope: CatalogScope,
	stay: { dates: StayDates; guests: number } | null,
): Promise<HomesListings> {
	if (stay) {
		const result = await searchAccommodationsLive({
			dates: stay.dates,
			guests: stay.guests,
			query,
			scope,
		});

		return {
			items: result.items.map((item) => item.listing),
			limit: result.limit,
			offset: result.offset,
			priceBounds: result.priceBounds,
			prices: searchPriceMap(result.items),
			total: result.total,
		};
	}

	const result = await getCachedCatalogList(query, scope);
	const [advisory, priceBounds] = await Promise.all([
		getCachedAdvisoryPrices(
			scope,
			result.items.map((item) => item.id),
		),
		getCachedPriceBounds(query, scope),
	]);

	return {
		items: result.items,
		limit: result.limit,
		offset: result.offset,
		priceBounds,
		prices: advisoryPriceMap(advisory),
		total: result.total,
	};
}

/**
 * Reads `searchParams` and loads the catalog. Kept as a deeper async component
 * wrapped in `<Suspense>` so the page shell (header/footer) stays prerenderable
 * and the request-bound work streams in instead of blocking the route.
 */
async function HomesContent({
	searchParams,
}: {
	searchParams: Promise<SearchParams>;
}) {
	const resolved = await searchParams;
	const params = toUrlParams(resolved);
	const preset = findLocationPreset(params.get("place"));

	const config = getListingCacheConfig();
	const scope = {
		accountId: config.hostifyAccountId,
		provider: HOSTIFY_PROVIDER,
	};

	const query = buildCatalogQuery(params, preset);
	const availability = parseAvailabilitySearchParams(params);
	const stay = availability.success
		? { dates: availability.data.dates, guests: availability.data.guests }
		: null;
	const stayQuery = stay ? buildStayQuery(params, stay) : undefined;

	const [result, amenityFacets] = await Promise.all([
		loadHomesListings(query, scope, stay),
		getCatalogAmenityFacets(scope),
	]);

	const mapCenter = preset
		? { latitude: preset.latitude, longitude: preset.longitude }
		: DEFAULT_MAP_CENTER;
	const mapZoom = preset ? PRESET_MAP_ZOOM : DEFAULT_MAP_ZOOM;

	return (
		<HomesPendingProvider>
			<div className="flex flex-col gap-6">
				<div className="flex flex-col gap-4">
					<div className="hidden sm:block">
						<LocationRail />
					</div>
					<HomesFilterBar
						amenityFacets={amenityFacets}
						currency={getAccommodationsConfig().currency}
						priceBounds={result.priceBounds}
						total={result.total}
					/>
				</div>

				<div className="h-72 overflow-hidden rounded-2xl border shadow-sm lg:hidden">
					<ListingsMapSlot
						slot="mobile"
						stayQuery={stayQuery}
						listings={result.items}
						prices={result.prices}
						center={mapCenter}
						zoom={mapZoom}
					/>
				</div>

				<div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_minmax(340px,400px)]">
					<HomesPendingResults>
						<ListingsResults
							currentParams={params}
							limit={result.limit}
							listings={result.items}
							offset={result.offset}
							prices={result.prices}
							stayQuery={stayQuery}
							total={result.total}
						/>
					</HomesPendingResults>
					<aside className="hidden lg:block">
						<div className="sticky top-24 h-[calc(100vh-7rem)] overflow-hidden rounded-2xl border shadow-sm">
							<ListingsMapSlot
								slot="desktop"
								stayQuery={stayQuery}
								listings={result.items}
								prices={result.prices}
								center={mapCenter}
								zoom={mapZoom}
							/>
						</div>
					</aside>
				</div>
			</div>
		</HomesPendingProvider>
	);
}

export default function HomesPage({
	searchParams,
}: {
	searchParams: Promise<SearchParams>;
}) {
	return (
		<div className="flex min-h-screen flex-col">
			<SiteHeader solid />
			<main className="flex-1 pt-16">
				<div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
					<Suspense fallback={<HomesSkeleton />}>
						<HomesContent searchParams={searchParams} />
					</Suspense>
				</div>
			</main>
			<SiteFooter />
		</div>
	);
}
