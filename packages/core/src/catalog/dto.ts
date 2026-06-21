import type {
	AccommodationListingProcessedContent,
	AccommodationListingRawContent,
	LocalizedText,
	ProcessedAmenity,
} from "@workspace/db";
import { hostifyPropertyTypeLabel } from "../hostify-property-types";
import type { CatalogLocale } from "./params";

export interface CatalogAmenityDto {
	icon: { name: string; set: string };
	id: string | null;
	key: string;
	label: string;
}

export interface CatalogPhotoDto {
	caption: string | null;
	thumbnailUrl: string | null;
	url: string;
}

export interface CatalogLocationDto {
	city: string | null;
	country: string | null;
	latitude: number | null;
	longitude: number | null;
	timezone: string | null;
}

export interface CatalogCapacityDto {
	bathrooms: number | null;
	bedrooms: number | null;
	beds: number | null;
	guests: number | null;
}

export interface CatalogReviewsDto {
	/** Combined average across all sources, or null when there are no ratings. */
	average: number | null;
	count: number;
}

export interface CatalogFreshnessDto {
	active: boolean;
	fetchedAt: string;
	isStale: boolean;
	providerUpdatedAt: string | null;
	staleAfter: string;
}

export interface CatalogListingSummaryDto {
	amenityCount: number;
	capacity: CatalogCapacityDto;
	coverPhoto: CatalogPhotoDto | null;
	distanceKm: number | null;
	freshness: CatalogFreshnessDto;
	id: string;
	location: CatalogLocationDto;
	propertyType: string | null;
	provider: string;
	reviews: CatalogReviewsDto;
	title: string;
}

export interface CatalogListingDetailDto extends CatalogListingSummaryDto {
	amenities: CatalogAmenityDto[];
	description: string;
	guide: string;
	nickname: string | null;
	photos: CatalogPhotoDto[];
}

/** Columns and JSONB selected from `accommodation_listing` for catalog reads. */
export interface CatalogListingRecord {
	active: boolean;
	bathrooms: number | null;
	bedrooms: number | null;
	beds: number | null;
	city: string | null;
	country: string | null;
	externalId: string;
	fetchedAt: Date;
	latitude: number | null;
	longitude: number | null;
	name: string | null;
	nickname: string | null;
	personCapacity: number | null;
	processed: AccommodationListingProcessedContent;
	propertyType: string | null;
	provider: string;
	providerUpdatedAt: Date | null;
	raw: AccommodationListingRawContent;
	reviewAverage: number | null;
	reviewCount: number;
	staleAfter: Date;
	timezone: string | null;
}

export interface CatalogMapOptions {
	distanceKm?: number | null;
	locale: CatalogLocale;
	now?: Date;
}

export function toCatalogListingSummary(
	record: CatalogListingRecord,
	options: CatalogMapOptions,
): CatalogListingSummaryDto {
	const now = options.now ?? new Date();
	const photos = extractPhotos(record.raw);

	return {
		amenityCount: record.processed.amenities.length,
		capacity: {
			bathrooms: record.bathrooms,
			bedrooms: record.bedrooms,
			beds: record.beds,
			guests: record.personCapacity,
		},
		coverPhoto: photos[0] ?? null,
		distanceKm: roundDistance(options.distanceKm),
		freshness: toFreshness(record, now),
		id: record.externalId,
		location: {
			city: record.city,
			country: record.country,
			latitude: record.latitude,
			longitude: record.longitude,
			timezone: record.timezone,
		},
		propertyType: pickPropertyType(record),
		provider: record.provider,
		reviews: {
			average: record.reviewCount > 0 ? record.reviewAverage : null,
			count: record.reviewCount,
		},
		title: pickTitle(record, options.locale),
	};
}

export function toCatalogListingDetail(
	record: CatalogListingRecord,
	options: CatalogMapOptions,
): CatalogListingDetailDto {
	return {
		...toCatalogListingSummary(record, options),
		amenities: record.processed.amenities.map((amenity) =>
			toAmenity(amenity, options.locale),
		),
		description: pickLocalized(record.processed.description, options.locale),
		guide: pickLocalized(record.processed.guide, options.locale),
		nickname: record.nickname,
		photos: extractPhotos(record.raw),
	};
}

function toFreshness(
	record: CatalogListingRecord,
	now: Date,
): CatalogFreshnessDto {
	return {
		active: record.active,
		fetchedAt: record.fetchedAt.toISOString(),
		isStale: record.staleAfter.getTime() <= now.getTime(),
		providerUpdatedAt: record.providerUpdatedAt?.toISOString() ?? null,
		staleAfter: record.staleAfter.toISOString(),
	};
}

function toAmenity(
	amenity: ProcessedAmenity,
	locale: CatalogLocale,
): CatalogAmenityDto {
	return {
		icon: { name: amenity.icon.name, set: amenity.icon.set },
		id: amenity.id,
		key: amenity.id ?? amenity.sourceLabel,
		label: pickLocalized(amenity.labels, locale) || amenity.sourceLabel,
	};
}

function pickPropertyType(record: CatalogListingRecord): string | null {
	return (
		record.propertyType ??
		readRawListingString(record.raw, "property_type") ??
		readRawListingString(record.raw, "property_type_group") ??
		hostifyPropertyTypeLabel(
			readRawListingString(record.raw, "property_type_id"),
		)
	);
}

function readRawListingString(
	raw: AccommodationListingRawContent,
	key: string,
): string | null {
	const listing = raw.listing;
	if (!isRecord(listing)) return null;

	const value = listing[key];
	if (typeof value === "string") return readString(value);
	if (typeof value === "number" || typeof value === "boolean") {
		return readString(String(value));
	}

	return null;
}

function pickTitle(
	record: CatalogListingRecord,
	locale: CatalogLocale,
): string {
	return (
		pickLocalized(record.processed.title, locale) ||
		record.name ||
		record.nickname ||
		record.externalId
	);
}

function pickLocalized(text: LocalizedText, locale: CatalogLocale): string {
	return (text[locale] || text.en || text.pt || text.es || "").trim();
}

function roundDistance(value: number | null | undefined): number | null {
	if (value === null || value === undefined || !Number.isFinite(value)) {
		return null;
	}

	return Math.round(value * 100) / 100;
}

function extractPhotos(raw: AccommodationListingRawContent): CatalogPhotoDto[] {
	if (!Array.isArray(raw.photos)) {
		return [];
	}

	return raw.photos
		.map((entry, index) => toPhoto(entry, index))
		.filter(
			(photo): photo is { photo: CatalogPhotoDto; sortOrder: number } =>
				photo !== null,
		)
		.sort((a, b) => a.sortOrder - b.sortOrder)
		.map((entry) => entry.photo);
}

function toPhoto(
	entry: unknown,
	index: number,
): { photo: CatalogPhotoDto; sortOrder: number } | null {
	if (!isRecord(entry)) {
		return null;
	}

	const url = readString(entry.photo) ?? readString(entry.original_file);
	if (!url) {
		return null;
	}

	return {
		photo: {
			caption: readString(entry.name) ?? readString(entry.description),
			thumbnailUrl:
				readString(entry.thumbnail) ?? readString(entry.thumbnail_file),
			url,
		},
		sortOrder: readNumber(entry.sort_order) ?? index,
	};
}

function readString(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}

	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function readNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
