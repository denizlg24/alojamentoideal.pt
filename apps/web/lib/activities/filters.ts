import type {
	ActivityDifficulty,
	ActivityDurationBucket,
	ActivityLocation,
	ActivitySummary,
} from "@workspace/core/activities";
import {
	DIFFICULTY_ORDER,
	DURATION_BUCKET_ORDER,
} from "@workspace/core/activities";
import {
	CATALOG_LOCATION_PRESETS,
	type CatalogLocationPreset,
} from "@/lib/catalog/locations";

export type ActivitiesSort =
	| "recommended"
	| "price_asc"
	| "price_desc"
	| "duration_asc";

export const ACTIVITIES_SORTS: ReadonlyArray<{
	label: string;
	value: ActivitiesSort;
}> = [
	{ label: "Recommended", value: "recommended" },
	{ label: "Price: low to high", value: "price_asc" },
	{ label: "Price: high to low", value: "price_desc" },
	{ label: "Shortest first", value: "duration_asc" },
];

export interface ActivitiesFilters {
	place: string | null;
	difficulties: ActivityDifficulty[];
	durations: ActivityDurationBucket[];
	priceMin: number | null;
	priceMax: number | null;
	sort: ActivitiesSort;
}

export const DEFAULT_ACTIVITIES_FILTERS: ActivitiesFilters = {
	place: null,
	difficulties: [],
	durations: [],
	priceMin: null,
	priceMax: null,
	sort: "recommended",
};

type SearchParamsInput =
	| URLSearchParams
	| Record<string, string | string[] | undefined>;

function toSearchParams(input: SearchParamsInput): URLSearchParams {
	if (input instanceof URLSearchParams) return input;
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(input)) {
		if (Array.isArray(value)) {
			for (const entry of value) params.append(key, entry);
		} else if (value !== undefined) {
			params.set(key, value);
		}
	}
	return params;
}

function parseEnumList<T extends string>(
	raw: string | null,
	allowed: readonly T[],
): T[] {
	if (!raw) return [];
	const set = new Set(raw.split(",").map((value) => value.trim()));
	return allowed.filter((value) => set.has(value));
}

function parsePositiveInt(raw: string | null): number | null {
	if (!raw) return null;
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parseSort(raw: string | null): ActivitiesSort {
	return ACTIVITIES_SORTS.some((option) => option.value === raw)
		? (raw as ActivitiesSort)
		: "recommended";
}

export function parseActivitiesFilters(
	input: SearchParamsInput,
): ActivitiesFilters {
	const params = toSearchParams(input);
	const place = params.get("place");
	return {
		place:
			place && CATALOG_LOCATION_PRESETS.some((preset) => preset.id === place)
				? place
				: null,
		difficulties: parseEnumList(params.get("difficulty"), DIFFICULTY_ORDER),
		durations: parseEnumList(params.get("duration"), DURATION_BUCKET_ORDER),
		priceMin: parsePositiveInt(params.get("priceMin")),
		priceMax: parsePositiveInt(params.get("priceMax")),
		sort: parseSort(params.get("sort")),
	};
}

export function buildActivitiesHref(filters: ActivitiesFilters): string {
	const params = new URLSearchParams();
	if (filters.place) params.set("place", filters.place);
	if (filters.difficulties.length) {
		params.set("difficulty", filters.difficulties.join(","));
	}
	if (filters.durations.length) {
		params.set("duration", filters.durations.join(","));
	}
	if (filters.priceMin !== null)
		params.set("priceMin", String(filters.priceMin));
	if (filters.priceMax !== null)
		params.set("priceMax", String(filters.priceMax));
	if (filters.sort !== "recommended") params.set("sort", filters.sort);
	const query = params.toString();
	return query ? `/activities?${query}` : "/activities";
}

/** Count of active filters, for the mobile "Filters (n)" affordance. */
export function countActivitiesFilters(filters: ActivitiesFilters): number {
	let count = 0;
	if (filters.place) count += 1;
	count += filters.difficulties.length;
	count += filters.durations.length;
	if (filters.priceMin !== null || filters.priceMax !== null) count += 1;
	return count;
}

const EARTH_RADIUS_KM = 6371;

function haversineKm(
	a: { latitude: number; longitude: number },
	b: { latitude: number; longitude: number },
): number {
	const toRad = (value: number) => (value * Math.PI) / 180;
	const dLat = toRad(b.latitude - a.latitude);
	const dLng = toRad(b.longitude - a.longitude);
	const lat1 = toRad(a.latitude);
	const lat2 = toRad(b.latitude);
	const h =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
	return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/**
 * Assigns an activity to one of the fixed service areas: nearest preset within
 * its radius when coordinates exist, otherwise a city-name match. Returns null
 * when it cannot be confidently placed (it then only shows under "All areas").
 */
export function resolveActivityPlaceId(
	location: ActivityLocation | null,
): string | null {
	if (!location) return null;

	if (location.latitude !== null && location.longitude !== null) {
		const point = {
			latitude: location.latitude,
			longitude: location.longitude,
		};
		let best: { preset: CatalogLocationPreset; distance: number } | null = null;
		for (const preset of CATALOG_LOCATION_PRESETS) {
			const distance = haversineKm(point, preset);
			if (distance <= preset.radiusKm && (!best || distance < best.distance)) {
				best = { preset, distance };
			}
		}
		if (best) return best.preset.id;
	}

	const city = location.city?.trim().toLowerCase();
	if (city) {
		// Exact match only. Substring matching risks placing an activity under the
		// wrong service area (e.g. a preset label that is a substring of an
		// unrelated city). An unmatched city degrades safely to "All areas".
		const match = CATALOG_LOCATION_PRESETS.find(
			(preset) => preset.label.toLowerCase() === city,
		);
		if (match) return match.id;
	}
	return null;
}

function matchesFilters(
	summary: ActivitySummary,
	filters: ActivitiesFilters,
): boolean {
	if (
		filters.place &&
		resolveActivityPlaceId(summary.location) !== filters.place
	) {
		return false;
	}
	if (
		filters.difficulties.length &&
		(summary.difficulty === null ||
			!filters.difficulties.includes(summary.difficulty))
	) {
		return false;
	}
	if (
		filters.durations.length &&
		(summary.duration.bucket === null ||
			!filters.durations.includes(summary.duration.bucket))
	) {
		return false;
	}
	if (filters.priceMin !== null || filters.priceMax !== null) {
		const amount = summary.fromPrice?.amount ?? null;
		if (amount === null) return false;
		if (filters.priceMin !== null && amount < filters.priceMin) return false;
		if (filters.priceMax !== null && amount > filters.priceMax) return false;
	}
	return true;
}

function compareForSort(
	a: ActivitySummary,
	b: ActivitySummary,
	sort: ActivitiesSort,
): number {
	const nullsLast = (value: number | null) => value ?? Number.POSITIVE_INFINITY;
	switch (sort) {
		case "price_asc":
			return (
				nullsLast(a.fromPrice?.amount ?? null) -
				nullsLast(b.fromPrice?.amount ?? null)
			);
		case "price_desc":
			return (
				(b.fromPrice?.amount ?? Number.NEGATIVE_INFINITY) -
				(a.fromPrice?.amount ?? Number.NEGATIVE_INFINITY)
			);
		case "duration_asc":
			return (
				nullsLast(a.duration.totalMinutes) - nullsLast(b.duration.totalMinutes)
			);
		default:
			return 0;
	}
}

export function applyActivitiesFilters(
	summaries: ActivitySummary[],
	filters: ActivitiesFilters,
): ActivitySummary[] {
	const filtered = summaries.filter((summary) =>
		matchesFilters(summary, filters),
	);
	if (filters.sort === "recommended") return filtered;
	return [...filtered].sort((a, b) => compareForSort(a, b, filters.sort));
}

export interface ActivitiesFacets {
	difficulties: ActivityDifficulty[];
	durations: ActivityDurationBucket[];
	placeIds: string[];
	priceBounds: { min: number; max: number } | null;
	priceCurrency: string;
}

/** Which filter options actually occur in the collection, for the filter bar. */
export function computeActivitiesFacets(
	summaries: ActivitySummary[],
): ActivitiesFacets {
	const placeIds = new Set<string>();
	const difficulties = new Set<ActivityDifficulty>();
	const durations = new Set<ActivityDurationBucket>();
	let currency: string | null = null;
	let min: number | null = null;
	let max: number | null = null;

	for (const summary of summaries) {
		const placeId = resolveActivityPlaceId(summary.location);
		if (placeId) placeIds.add(placeId);
		if (summary.difficulty) difficulties.add(summary.difficulty);
		if (summary.duration.bucket) durations.add(summary.duration.bucket);
		const amount = summary.fromPrice?.amount ?? null;
		if (amount !== null) {
			currency ??= summary.fromPrice?.currency ?? null;
			min = min === null ? amount : Math.min(min, amount);
			max = max === null ? amount : Math.max(max, amount);
		}
	}

	return {
		placeIds: CATALOG_LOCATION_PRESETS.filter((preset) =>
			placeIds.has(preset.id),
		).map((preset) => preset.id),
		difficulties: DIFFICULTY_ORDER.filter((value) => difficulties.has(value)),
		durations: DURATION_BUCKET_ORDER.filter((value) => durations.has(value)),
		priceBounds:
			min !== null && max !== null
				? { min: Math.floor(min), max: Math.ceil(max) }
				: null,
		priceCurrency: currency ?? "EUR",
	};
}
