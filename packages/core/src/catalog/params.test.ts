import { describe, expect, test } from "bun:test";
import { parseCatalogListQuery, parseCatalogLocale } from "./params";

function parse(query: string) {
	return parseCatalogListQuery(new URLSearchParams(query));
}

describe("parseCatalogListQuery", () => {
	test("applies defaults", () => {
		const result = parse("");
		expect(result.success).toBe(true);
		if (!result.success) return;

		expect(result.data.limit).toBe(20);
		expect(result.data.offset).toBe(0);
		expect(result.data.locale).toBe("en");
		expect(result.data.sort).toBe("recent");
		expect(result.data.amenities).toEqual([]);
		expect(result.data.includeInactive).toBe(false);
		expect(result.data.radius).toBeNull();
	});

	test("parses filters, radius and pagination", () => {
		const result = parse(
			"q=loft&city=Porto&guests=4&bedroomsMin=2&bathroomsMin=1&propertyType=apartment&lat=41.15&lng=-8.61&radiusKm=5&limit=10&offset=20",
		);
		expect(result.success).toBe(true);
		if (!result.success) return;

		expect(result.data.text).toBe("loft");
		expect(result.data.city).toBe("Porto");
		expect(result.data.minGuests).toBe(4);
		expect(result.data.bedroomsMin).toBe(2);
		expect(result.data.bathroomsMin).toBe(1);
		expect(result.data.propertyType).toBe("apartment");
		expect(result.data.radius).toEqual({
			latitude: 41.15,
			longitude: -8.61,
			radiusKm: 5,
		});
		expect(result.data.limit).toBe(10);
		expect(result.data.offset).toBe(20);
		// Defaults to relevance when text is present.
		expect(result.data.sort).toBe("relevance");
	});

	test("merges repeated and comma-separated amenities, deduped", () => {
		const result = parse(
			"amenities=wifi,pool&amenities=wifi&amenities=parking",
		);
		expect(result.success).toBe(true);
		if (!result.success) return;

		expect(result.data.amenities.sort()).toEqual(["parking", "pool", "wifi"]);
	});

	test("rejects partial radius", () => {
		const result = parse("lat=41.15&radiusKm=5");
		expect(result.success).toBe(false);
	});

	test("rejects distance sort without coordinates", () => {
		const result = parse("sort=distance");
		expect(result.success).toBe(false);
	});

	test("rejects out-of-range latitude", () => {
		const result = parse("lat=200&lng=10&radiusKm=5");
		expect(result.success).toBe(false);
	});

	test("rejects limit above maximum", () => {
		const result = parse("limit=500");
		expect(result.success).toBe(false);
	});
});

describe("parseCatalogLocale", () => {
	test("accepts supported locales", () => {
		expect(parseCatalogLocale("pt")).toBe("pt");
	});

	test("falls back to en", () => {
		expect(parseCatalogLocale("fr")).toBe("en");
		expect(parseCatalogLocale(null)).toBe("en");
	});
});
