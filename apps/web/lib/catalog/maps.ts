const CARTO_LIGHT_TILE_URL =
	"https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";

export const CARTO_TILE_ATTRIBUTION =
	'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

/**
 * Builds the public CARTO raster tile URL. CARTO keys are intentionally sent to
 * the browser and should be restricted to the site's domains in their dashboard.
 */
export function getCartoTileUrl(
	apiKey = process.env.NEXT_PUBLIC_CARTO_API_KEY,
): string {
	const key = apiKey?.trim();
	return key
		? `${CARTO_LIGHT_TILE_URL}?key=${encodeURIComponent(key)}`
		: CARTO_LIGHT_TILE_URL;
}
