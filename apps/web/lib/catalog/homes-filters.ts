import { capacityForGuests } from "./guests";

/**
 * User-facing homes search state. This is the shape the filter bar edits and
 * serializes into the `/homes` URL. The page resolves `place` to a radius
 * search and reads `guests` (derived capacity) when querying the catalog. Price
 * is intentionally absent: pricing is placeholder-only and not filterable yet.
 */
export interface HomesFilters {
	adults: number;
	amenities: string[];
	bathroomsMin: number | null;
	bedroomsMin: number | null;
	checkIn: string | null;
	checkOut: string | null;
	children: number;
	place: string | null;
	priceMax: number | null;
	priceMin: number | null;
	ratingMin: number | null;
	sort: string | null;
}

export const HOMES_PAGE_SIZE = 12;

export const DEFAULT_HOMES_FILTERS: HomesFilters = {
	adults: 1,
	amenities: [],
	bathroomsMin: null,
	bedroomsMin: null,
	checkIn: null,
	checkOut: null,
	children: 0,
	place: null,
	priceMax: null,
	priceMin: null,
	ratingMin: null,
	sort: null,
};

function readInt(value: string | null, fallback: number): number {
	if (value === null) return fallback;
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) ? parsed : fallback;
}

function readFloat(value: string | null): number | null {
	if (value === null) return null;
	const parsed = Number.parseFloat(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function readDate(value: string | null): string | null {
	if (value === null) return null;
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
	const date = new Date(`${value}T00:00:00.000Z`);
	if (Number.isNaN(date.getTime())) return null;
	return value;
}

export function parseHomesFilters(params: URLSearchParams): HomesFilters {
	const amenities = (params.get("amenities") ?? "")
		.split(",")
		.map((value) => value.trim())
		.filter((value) => value.length > 0);

	return {
		adults: Math.max(1, readInt(params.get("adults"), 1)),
		amenities,
		bathroomsMin: readFloat(params.get("bathroomsMin")),
		bedroomsMin: readFloat(params.get("bedroomsMin")),
		checkIn: readDate(params.get("checkIn")),
		checkOut: readDate(params.get("checkOut")),
		children: Math.max(0, readInt(params.get("children"), 0)),
		place: params.get("place"),
		priceMax: readFloat(params.get("priceMax")),
		priceMin: readFloat(params.get("priceMin")),
		ratingMin: readFloat(params.get("ratingMin")),
		sort: params.get("sort"),
	};
}

/**
 * Serializes filters into URL params. Resets pagination implicitly by omitting
 * `offset`, so any filter change returns the user to the first page.
 */
export function buildHomesSearchParams(filters: HomesFilters): URLSearchParams {
	const params = new URLSearchParams();

	if (filters.place) params.set("place", filters.place);
	if (filters.checkIn) params.set("checkIn", filters.checkIn);
	if (filters.checkOut) params.set("checkOut", filters.checkOut);

	params.set("adults", String(filters.adults));
	params.set("children", String(filters.children));
	params.set(
		"guests",
		String(capacityForGuests(filters.adults, filters.children)),
	);

	if (filters.sort) params.set("sort", filters.sort);
	if (filters.priceMin !== null) {
		params.set("priceMin", String(filters.priceMin));
	}
	if (filters.priceMax !== null) {
		params.set("priceMax", String(filters.priceMax));
	}
	if (filters.ratingMin !== null) {
		params.set("ratingMin", String(filters.ratingMin));
	}
	if (filters.bedroomsMin !== null) {
		params.set("bedroomsMin", String(filters.bedroomsMin));
	}
	if (filters.bathroomsMin !== null) {
		params.set("bathroomsMin", String(filters.bathroomsMin));
	}
	if (filters.amenities.length > 0) {
		params.set("amenities", filters.amenities.join(","));
	}

	return params;
}

export function buildHomesHref(filters: HomesFilters): string {
	return `/homes?${buildHomesSearchParams(filters).toString()}`;
}

/** Count of filters shown in the "All filters" badge (rating, beds, baths, amenities). */
export function countAdvancedFilters(filters: HomesFilters): number {
	let count = 0;
	if (filters.ratingMin !== null) count += 1;
	if (filters.bedroomsMin !== null) count += 1;
	if (filters.bathroomsMin !== null) count += 1;
	if (filters.priceMin !== null || filters.priceMax !== null) count += 1;
	count += filters.amenities.length;
	return count;
}
