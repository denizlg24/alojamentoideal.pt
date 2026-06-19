import { describe, expect, test } from "bun:test";
import type { AccommodationListingProcessedContent } from "@workspace/db";
import { buildListingSearchIndex } from "./search-index";

function processed(
	amenities: AccommodationListingProcessedContent["amenities"],
): AccommodationListingProcessedContent {
	return {
		amenities,
		description: { en: "Sea view flat", es: "Piso", pt: "Apartamento" },
		guide: { en: "", es: "", pt: "" },
		model: null,
		title: { en: "Ocean Loft", es: "", pt: "Loft Oceano" },
	};
}

function amenity(
	id: string | null,
	sourceLabel: string,
	labelEn: string,
): AccommodationListingProcessedContent["amenities"][number] {
	return {
		icon: { name: "house", set: "fa6" },
		id,
		labels: { en: labelEn, es: labelEn, pt: labelEn },
		sourceLabel,
	};
}

describe("buildListingSearchIndex", () => {
	test("keys prefer amenity id and fall back to sourceLabel, deduped", () => {
		const result = buildListingSearchIndex({
			city: "Porto",
			country: "PT",
			name: "Loft",
			nickname: null,
			processed: processed([
				amenity("12", "Wifi", "Wifi"),
				amenity(null, "Pool", "Pool"),
				amenity("12", "Wifi", "Wifi"),
			]),
			propertyType: "apartment",
		});

		expect(result.amenityKeys.sort()).toEqual(["12", "Pool"]);
	});

	test("keys with empty-string IDs fall back to sourceLabel", () => {
		const result = buildListingSearchIndex({
			city: "Porto",
			country: "PT",
			name: "Loft",
			nickname: null,
			processed: processed([
				amenity("", "Parking", "Parking"),
				amenity("12", "Wifi", "Wifi"),
			]),
			propertyType: "apartment",
		});

		expect(result.amenityKeys.sort()).toEqual(["12", "Parking"]);
	});

	test("title column carries name and localized titles", () => {
		const result = buildListingSearchIndex({
			city: "Porto",
			country: "PT",
			name: "Loft",
			nickname: null,
			processed: processed([]),
			propertyType: "apartment",
		});

		expect(result.searchTitle).toContain("Loft");
		expect(result.searchTitle).toContain("Ocean Loft");
		expect(result.searchTitle).toContain("Loft Oceano");
		// Location and body terms must not bleed into the title weight.
		expect(result.searchTitle).not.toContain("Porto");
		expect(result.searchTitle).not.toContain("Sea view flat");
	});

	test("location column carries city, country and property type", () => {
		const result = buildListingSearchIndex({
			city: "Porto",
			country: "PT",
			name: "Loft",
			nickname: null,
			processed: processed([]),
			propertyType: "apartment",
		});

		expect(result.searchLocation).toBe("Porto PT apartment");
	});

	test("body column carries localized descriptions and amenity labels", () => {
		const result = buildListingSearchIndex({
			city: "Porto",
			country: "PT",
			name: "Loft",
			nickname: null,
			processed: processed([amenity("12", "Wifi", "Wireless internet")]),
			propertyType: "apartment",
		});

		expect(result.searchBody).toContain("Sea view flat");
		expect(result.searchBody).toContain("Apartamento");
		expect(result.searchBody).toContain("Wireless internet");
	});

	test("identical duplicate fragments are collapsed within a column", () => {
		const result = buildListingSearchIndex({
			city: "Porto",
			country: "PT",
			name: "Porto",
			nickname: "Porto",
			processed: processed([]),
			propertyType: null,
		});

		// name and nickname both equal "Porto" -> single token in the title column.
		expect(result.searchTitle.match(/Porto/g)?.length).toBe(1);
	});
});
