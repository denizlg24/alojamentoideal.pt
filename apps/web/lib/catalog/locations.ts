/**
 * Fixed service areas for Alojamento Ideal. The operator owns apartments in a
 * handful of Northern Portugal locations, so geo search is driven by these
 * presets (coordinates + a sensible search radius) rather than a live geocoder.
 * The homes page resolves the `place` query param to one of these and turns it
 * into the catalog list API's radius filter; the map also centers on it.
 */
export interface CatalogLocationPreset {
	id: string;
	label: string;
	region: string;
	latitude: number;
	longitude: number;
	radiusKm: number;
}

export const CATALOG_LOCATION_PRESETS: readonly CatalogLocationPreset[] = [
	{
		id: "porto",
		label: "Porto",
		region: "Northern Portugal",
		latitude: 41.1579,
		longitude: -8.6291,
		radiusKm: 12,
	},
	{
		id: "povoa-de-varzim",
		label: "Póvoa de Varzim",
		region: "Northern Portugal",
		latitude: 41.3833,
		longitude: -8.7667,
		radiusKm: 8,
	},
	{
		id: "leca-da-palmeira",
		label: "Leça da Palmeira",
		region: "Northern Portugal",
		latitude: 41.1936,
		longitude: -8.7008,
		radiusKm: 6,
	},
	{
		id: "canidelo",
		label: "Canidelo",
		region: "Northern Portugal",
		latitude: 41.1336,
		longitude: -8.6535,
		radiusKm: 6,
	},
] as const;

/** Map center used when no preset is selected (covers the North Coast cluster). */
export const DEFAULT_MAP_CENTER = {
	latitude: 41.22,
	longitude: -8.68,
} as const;
export const DEFAULT_MAP_ZOOM = 10;
export const PRESET_MAP_ZOOM = 12;

export function findLocationPreset(
	id: string | null | undefined,
): CatalogLocationPreset | null {
	if (!id) {
		return null;
	}

	return CATALOG_LOCATION_PRESETS.find((preset) => preset.id === id) ?? null;
}
