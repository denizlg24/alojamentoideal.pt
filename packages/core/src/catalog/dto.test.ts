import { describe, expect, test } from "bun:test";
import type { AccommodationListingProcessedContent } from "@workspace/db";
import {
	type CatalogListingRecord,
	toCatalogListingDetail,
	toCatalogListingSummary,
} from "./dto";

const PROCESSED: AccommodationListingProcessedContent = {
	amenities: [
		{
			icon: { name: "wifi", set: "fa6" },
			id: "12",
			labels: { en: "Wifi", es: "Wifi", pt: "Internet" },
			sourceLabel: "Wifi",
		},
	],
	description: { en: "English desc", es: "", pt: "Descricao PT" },
	guide: { en: "Guide", es: "", pt: "" },
	model: "gpt-5.5",
	title: { en: "Ocean Loft", es: "", pt: "Loft Oceano" },
};

function record(
	overrides: Partial<CatalogListingRecord> = {},
): CatalogListingRecord {
	return {
		active: true,
		bathrooms: 1,
		bedrooms: 2,
		beds: 3,
		city: "Porto",
		country: "PT",
		externalId: "999",
		fetchedAt: new Date("2026-06-18T00:00:00Z"),
		latitude: 41.15,
		longitude: -8.61,
		name: "Loft",
		nickname: "Cozy Loft",
		personCapacity: 4,
		processed: PROCESSED,
		propertyType: "apartment",
		provider: "hostify",
		providerUpdatedAt: new Date("2026-06-17T00:00:00Z"),
		raw: {
			fees: null,
			guestGuide: null,
			listing: {},
			photos: [
				{
					photo: "https://cdn/b.jpg",
					sort_order: 2,
					thumbnail: "https://cdn/b-t.jpg",
				},
				{
					name: "Front",
					photo: "https://cdn/a.jpg",
					sort_order: 1,
					thumbnail: null,
				},
				{ caption: "no url" },
			],
			status: null,
			translations: null,
		},
		reviewAverage: null,
		reviewCount: 0,
		staleAfter: new Date("2026-06-19T00:00:00Z"),
		timezone: "Europe/Lisbon",
		...overrides,
	};
}

describe("toCatalogListingSummary", () => {
	test("maps typed fields and picks localized title", () => {
		const summary = toCatalogListingSummary(record(), {
			locale: "pt",
			now: new Date("2026-06-18T12:00:00Z"),
		});

		expect(summary.id).toBe("999");
		expect(summary.title).toBe("Loft Oceano");
		expect(summary.capacity).toEqual({
			bathrooms: 1,
			bedrooms: 2,
			beds: 3,
			guests: 4,
		});
		expect(summary.location.timezone).toBe("Europe/Lisbon");
		expect(summary.amenityCount).toBe(1);
		expect(summary.freshness.isStale).toBe(false);
		expect(summary.freshness.active).toBe(true);
		expect(summary.reviews).toEqual({
			average: null,
			count: 0,
		});
	});

	test("cover photo is the lowest sort_order with a url", () => {
		const summary = toCatalogListingSummary(record(), { locale: "en" });
		expect(summary.coverPhoto?.url).toBe("https://cdn/a.jpg");
		expect(summary.coverPhoto?.caption).toBe("Front");
	});

	test("marks rows past staleAfter as stale", () => {
		const summary = toCatalogListingSummary(record(), {
			locale: "en",
			now: new Date("2026-06-20T00:00:00Z"),
		});
		expect(summary.freshness.isStale).toBe(true);
	});

	test("rounds provided distance", () => {
		const summary = toCatalogListingSummary(record(), {
			distanceKm: 3.146,
			locale: "en",
		});
		expect(summary.distanceKm).toBe(3.15);
	});

	test("includes reviews when count > 0", () => {
		const summary = toCatalogListingSummary(
			record({ reviewAverage: 4.7, reviewCount: 23 }),
			{ locale: "en" },
		);
		expect(summary.reviews).toEqual({
			average: 4.7,
			count: 23,
		});
	});

	test("sets reviews average to null when count is 0", () => {
		const summary = toCatalogListingSummary(
			record({ reviewAverage: null, reviewCount: 0 }),
			{ locale: "en" },
		);
		expect(summary.reviews).toEqual({
			average: null,
			count: 0,
		});
	});

	test("never leaks raw or normalized payloads", () => {
		const summary = toCatalogListingSummary(record(), { locale: "en" });
		expect(summary).not.toHaveProperty("raw");
		expect(summary).not.toHaveProperty("normalized");
		expect(JSON.stringify(summary)).not.toContain("guestGuide");
	});
});

describe("toCatalogListingDetail", () => {
	test("includes localized content, amenities and sorted photos", () => {
		const detail = toCatalogListingDetail(record(), { locale: "pt" });

		expect(detail.description).toBe("Descricao PT");
		expect(detail.amenities).toEqual([
			{
				icon: { name: "wifi", set: "fa6" },
				id: "12",
				key: "12",
				label: "Internet",
			},
		]);
		expect(detail.photos.map((photo) => photo.url)).toEqual([
			"https://cdn/a.jpg",
			"https://cdn/b.jpg",
		]);
	});

	test("falls back to english when locale missing", () => {
		const detail = toCatalogListingDetail(record(), { locale: "es" });
		expect(detail.description).toBe("English desc");
		expect(detail.title).toBe("Ocean Loft");
	});
});
